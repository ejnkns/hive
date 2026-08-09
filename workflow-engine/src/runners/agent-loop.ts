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

import type { ChatMessage } from "../shared/chat-message";
import type { TaskDefinition } from "../task-runner";
import type { ModelCallStatus } from "../workflow-types";
import { resolveDottedPath } from "./resolve-dotted-path";
import { resolveWorkspacePath } from "./resolve-workspace-path";
import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolResult,
} from "./tool-types";

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
};

export type AgentLoopConfig = {
  signal: AbortSignal;
  modelCaller: AgentModelCaller;
  toolDefinitions: Record<string, ToolDefinition>;
  toolExecutors: Record<string, ToolExecutor>;
  behavior: AgentTurnBehavior;
  maxIterations: number;
  completionTool?: string;
  completionSignal?: string;
  basePath?: string;
  instanceId?: string;
  patchWorkflowInstanceState?: (patch: Record<string, unknown>) => void;
  // Live model-call progress into the running task context (see ModelCallStatus).
  patchRunningTaskStatus?: (status: ModelCallStatus) => void;
  // The instance's domain data, resolved against by @instance: workspacePath
  // refs (e.g. "@instance:worktreePath").
  workflowInstanceState?: Record<string, unknown>;
  // The create_instance capability, offered to the model when the task
  // declares the tool. Takes domain state and returns the new instance id.
  createWorkflowInstance?: (
    workflowId: string,
    instanceState?: Record<string, unknown>
  ) => { id: string };
};

// Runs the agent loop to completion (or budget exhaustion). `messages` is the
// runner-seeded transcript (system prompt, injected instance-state input);
// the loop appends assistant and tool turns to it. Returns the task output
// value; the runner wraps it in the TaskRunner's `{ output }` contract.
export async function runAgentLoop(
  task: TaskDefinition,
  messages: ChatMessage[],
  config: AgentLoopConfig
): Promise<unknown> {
  const workspacePath = resolveWorkspacePath(
    task.workspacePath,
    config.workflowInstanceState,
    config.basePath
  );
  const toolDefs = (task.tools ?? [])
    .map((name) => config.toolDefinitions[name])
    .filter(Boolean);

  const completionTool = task.completionTool ?? config.completionTool;
  const completionSignal = task.completionSignal ?? config.completionSignal;

  for (let iteration = 0; iteration < config.maxIterations; iteration++) {
    config.signal.throwIfAborted();

    config.patchRunningTaskStatus?.({ stage: "routing" });
    const response = await config.modelCaller(
      task.systemPrompt ?? "",
      messages,
      toolDefs,
      config.signal,
      config.patchRunningTaskStatus
    );
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
          instanceId: config.instanceId,
          patchWorkflowInstanceState: config.patchWorkflowInstanceState,
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
