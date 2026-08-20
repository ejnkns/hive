/** @private — the shared agent loop for the ai-task and ai-chat runners.
 *
 * The two AI runners execute the same mechanics — seed messages, call the
 * model, push the assistant turn, check completion, execute tool calls with
 * error recovery, respect the iteration budget — and differ only in turn
 * behavior: how a turn ends, what happens when the model stops calling tools,
 * and whether the transcript syncs live. This module holds the shared loop;
 * each runner supplies its role's behavior (`AgentTurnBehavior`) and wraps the
 * result in the role's output contract.
 *
 * The role differences, in one place:
 *   - ai-task: one-shot; ends when the model calls the completion tool (raw
 *     arguments become the output) or stops calling tools (the transcript is
 *     the output); no live transcript sync.
 *   - ai-chat: multi-turn; ends via completionSignal OR the completion tool
 *     (the output wraps the transcript + parsed completion arguments); when
 *     the model stops calling tools the session waits for user input
 *     (startOnUserInput) or auto-reprompts; the transcript syncs live. */

import type { ChatMessage } from "../shared/chat-message.ts";
import type { TaskDefinition } from "../task-runner.ts";
import type { ModelCallStatus } from "../workflow-types.ts";
import { resolveGrantedRoots } from "./read-grants.ts";
import { resolveDottedPath } from "./resolve-dotted-path.ts";
import { resolveWorkspacePath } from "./resolve-workspace-path.ts";
import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolResult,
} from "./tool-types.ts";

export type AgentModelCaller = (
  systemPrompt: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  // Live model-call progress (routing → dispatched → thinking → streaming →
  // complete), reported by the caller into the running task context.
  onStatus?: (status: ModelCallStatus) => void
) => Promise<{ content: string; toolCalls?: ToolCall[] }>;

// The role-specific behavior of a loop turn.
export type AgentTurnBehavior = {
  // Called after the assistant message and after each tool result are pushed
  // to the transcript. ai-chat syncs the live transcript into instance state
  // here so observers render it as it grows; ai-task is a no-op.
  onMessagesChanged?: (messages: ChatMessage[]) => void;
  // The runner's wait-for-external-input gate (ai-chat's turnResolve promise
  // released by sendMessage). Required when onNoToolCalls can return "wait".
  waitForInput?: () => Promise<void>;
  // The response signals completion (completionSignal matched or the
  // completion tool called). Build the task output. `completionCall` is the
  // parsed completion tool call, or undefined when completion happened via
  // the signal.
  onComplete: (
    response: { content: string; toolCalls?: ToolCall[] },
    completionCall: ToolCall | undefined,
    messages: ChatMessage[]
  ) => unknown;
  // The model returned no tool calls. Decide how the turn continues:
  //   "return"  — the task is done; `output` is its output (ai-task).
  //   "wait"    — pause for external input (ai-chat interactive sessions).
  //   "reprompt" — push a continuation message and keep looping (ai-chat
  //                one-shot sessions that must not stall).
  onNoToolCalls: (
    response: { content: string; toolCalls?: ToolCall[] },
    messages: ChatMessage[],
    task: TaskDefinition
  ) => Promise<
    | { action: "return"; output: unknown }
    | { action: "wait" }
    | { action: "reprompt"; message: string }
  >;
  // The model call threw (a mid-stream upstream failure, a provider outage).
  // Decide how the turn continues:
  //   "wait"    — surface the failure to the session and wait for input
  //               (interactive ai-chat sessions survive transient failures:
  //               the human continues by sending a message).
  //   "throw"   — fail the task; flows route task errors via gates/actions.
  // Absent: throw.
  onModelCallError?: (
    err: unknown,
    messages: ChatMessage[],
    task: TaskDefinition
  ) => Promise<{ action: "wait" } | { action: "throw" }>;
};

export type AgentLoopConfig = AgentRunnerConfig & {
  signal: AbortSignal;
  behavior: AgentTurnBehavior;
  maxIterations: number;
  completionSignal?: string;
};

// The capabilities every AI runner (and the loop itself) needs — declared
// once so a new capability is threaded through one type, not three. The two
// runner configs (create-ai-task-runner / create-ai-chat-runner) and
// `AgentLoopConfig` all derive from this; a capability added here is required
// at every call site by the compiler.
export type AgentRunnerConfig = {
  modelCaller: AgentModelCaller;
  toolDefinitions: Record<string, ToolDefinition>;
  toolExecutors: Record<string, ToolExecutor>;
  completionTool?: string;
  basePath?: string;
  // Declared read-only roots the file tools may access alongside the
  // workspace (from the flow config), resolved absolute.
  extraReadRoots?: readonly string[];
  instanceId?: string;
  patchWorkflowInstanceState?: (patch: Record<string, unknown>) => void;
  // Live model-call progress into the running task context (see ModelCallStatus).
  patchRunningTaskStatus?: (status: ModelCallStatus) => void;
  // The instance's domain data, resolved against by @instance: workspacePath
  // refs (e.g. "@instance:worktreePath"). A live getter, so tool/ref reads
  // see the current state (patches by earlier turns, the flow, or the
  // instance-state API).
  workflowInstanceState?: () => Record<string, unknown>;
  // Flow-level state read (E2), threaded into the ToolContext so tools can
  // read the flow's declared cross-entity state (e.g. the taxonomy). Tools
  // read only — flowState writes belong to operations via patchFlowState.
  flowState?: () => Record<string, unknown>;
  // The create_instance capability, offered to the model when the task
  // declares the tool. Takes domain state and returns the new instance id.
  createWorkflowInstance?: (
    workflowId: string,
    instanceState?: Record<string, unknown>,
    stateId?: string
  ) => { id: string };
};

// Seeds a transcript with the system prompt + the task's instance-state input
// (the first user message), uniformly for both runners — the transcript is
// self-contained (system, injected input, then the turns), so the shapes can't
// diverge when live sync or rendering is added.
export function seedTranscript(
  messages: ChatMessage[],
  task: TaskDefinition,
  instanceState: Record<string, unknown> | undefined
): void {
  messages.push({ role: "system", content: task.systemPrompt ?? "" });
  seedTaskInput(messages, instanceState, task.inputFromInstanceState);
}

// The pre-flight guard shared by both AI runners: a task with no system prompt
// and no input has nothing to work on. Calling the model anyway spends
// provider calls on an effectively empty prompt (`[{role:"system",content:""}]`)
// and can wedge the instance forever on a stream that never completes — e.g.
// an auto-run task on an instance created with an empty payload, restarted on
// every server boot. Fail fast so taskError gates route the instance to an
// error/needs-review state instead of a zombie task. A declared input is the
// same contract one level up: a task that says inputFromInstanceState must
// actually receive it (an instance created without it has nothing to work on).
function assertWorkableInput(
  messages: ChatMessage[],
  task: TaskDefinition
): void {
  const declaredInputMissing =
    task.inputFromInstanceState !== undefined &&
    !messages.some((message) => message.role === "user");
  if (declaredInputMissing) {
    throw new Error(
      `task "${task.id}" declares inputFromInstanceState "${task.inputFromInstanceState}" but the instance was created without it — seed the instance with that field`
    );
  }
  const hasPrompt = (task.systemPrompt ?? "").trim() !== "";
  const hasInput = messages.some((message) => message.content.trim() !== "");
  if (!hasPrompt && !hasInput) {
    throw new Error(
      `task "${task.id}" has no system prompt and no input to work on — declare a systemPrompt or inputFromInstanceState`
    );
  }
}

// Runs the agent loop to completion (or budget exhaustion). `messages` is the
// runner-seeded transcript (system prompt, injected instance-state input);
// the loop appends assistant and tool turns to it. Returns the task output
// value; the runner wraps it in the TaskRunner's `{ output }` contract.
export async function runAgentLoop(
  task: TaskDefinition,
  messages: ChatMessage[],
  config: AgentLoopConfig
): Promise<unknown> {
  assertWorkableInput(messages, task);
  const workspacePath = resolveWorkspacePath(
    task.workspacePath,
    config.workflowInstanceState?.(),
    config.basePath
  );
  // The file tools' read roots: the flow's declared roots plus every path the
  // human granted in chat (a user message that is itself a path). Computed
  // per tool call from the live transcript, so a path typed mid-session takes
  // effect immediately.
  const extraReadRoots = [
    ...(config.extraReadRoots ?? []),
    ...resolveGrantedRoots(messages, config.basePath),
  ];
  const toolDefs = (task.tools ?? [])
    .map((name) => config.toolDefinitions[name])
    .filter(Boolean);

  const completionTool = task.completionTool ?? config.completionTool;
  const completionSignal = task.completionSignal ?? config.completionSignal;

  for (let iteration = 0; iteration < config.maxIterations; iteration++) {
    config.signal.throwIfAborted();

    config.patchRunningTaskStatus?.({ stage: "routing" });
    let response: { content: string; toolCalls?: ToolCall[] };
    try {
      response = await config.modelCaller(
        task.systemPrompt ?? "",
        messages,
        toolDefs,
        config.signal,
        config.patchRunningTaskStatus
      );
    } catch (err) {
      // An aborted call is the caller's decision, not a model failure.
      if (config.signal.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      config.patchRunningTaskStatus?.({ stage: "error", message });
      const decision = (await config.behavior.onModelCallError?.(
        err,
        messages,
        task
      )) ?? {
        action: "throw" as const,
      };
      if (decision.action === "wait") {
        // The session surfaces the failure (the behavior appends an error
        // note to the transcript) and waits for the human to continue; the
        // next iteration re-calls the model with the full transcript.
        await config.behavior.waitForInput?.();
        continue;
      }
      throw err;
    }
    config.patchRunningTaskStatus?.({ stage: "complete" });

    messages.push({
      role: "assistant",
      content: response.content,
      ...(response.toolCalls?.length
        ? {
            tool_calls: response.toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    });
    config.behavior.onMessagesChanged?.(messages);

    const completeBySignal =
      completionSignal !== undefined &&
      response.content.includes(completionSignal);
    const completionCall = response.toolCalls?.find(
      (call) => call.name === completionTool
    );
    if (completeBySignal || completionCall) {
      return config.behavior.onComplete(response, completionCall, messages);
    }

    if (!response.toolCalls?.length) {
      const decision = await config.behavior.onNoToolCalls(
        response,
        messages,
        task
      );
      if (decision.action === "return") return decision.output;
      if (decision.action === "wait") {
        await config.behavior.waitForInput?.();
        continue;
      }
      messages.push({ role: "user", content: decision.message });
      config.behavior.onMessagesChanged?.(messages);
      continue;
    }

    for (const call of response.toolCalls) {
      config.signal.throwIfAborted();
      const executor = config.toolExecutors[call.name];
      if (!executor) {
        messages.push({
          role: "tool",
          content: `Unknown tool: ${call.name}`,
          tool_call_id: call.id,
        });
        config.behavior.onMessagesChanged?.(messages);
        continue;
      }
      let result: ToolResult;
      try {
        result = await executor(call, {
          workspacePath,
          basePath: config.basePath,
          extraReadRoots,
          instanceId: config.instanceId,
          patchWorkflowInstanceState: config.patchWorkflowInstanceState,
          workflowInstanceState: () => config.workflowInstanceState?.() ?? {},
          flowState: () => config.flowState?.() ?? {},
          createWorkflowInstance: config.createWorkflowInstance,
          signal: config.signal,
        });
      } catch (err) {
        // A throwing tool must not kill the run — surface the failure to the
        // model as a tool result so it can recover.
        messages.push({
          role: "tool",
          content: `Tool "${call.name}" failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          tool_call_id: call.id,
        });
        config.behavior.onMessagesChanged?.(messages);
        continue;
      }
      messages.push({
        role: "tool",
        content: result.content,
        tool_call_id: call.id,
      });
      config.behavior.onMessagesChanged?.(messages);
    }
  }

  throw new Error("Iteration budget exhausted");
}

// Parses a completion tool's arguments into a plain record; returns {} when
// the arguments are not valid JSON so a malformed completion never fails the
// session (the transcript still carries the completion).
export function safeParseArguments(
  argumentsText: string
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// Seeds the transcript with the task's instance-state input (the first user
// message), shared by both runners.
export function seedTaskInput(
  messages: ChatMessage[],
  instanceState: Record<string, unknown> | undefined,
  inputPath: string | undefined
): void {
  const injectedInput = resolveDottedPath(instanceState ?? {}, inputPath);
  if (injectedInput !== undefined) {
    messages.push({
      role: "user",
      content:
        typeof injectedInput === "string"
          ? injectedInput
          : JSON.stringify(injectedInput),
    });
  }
}
