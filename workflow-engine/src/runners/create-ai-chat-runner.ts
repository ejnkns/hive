/** @private — only imported by runners.ts */
import type { TaskDefinition, TaskRunner } from "../task-runner";
import type { ChatMessage } from "../workflow-types";
import { resolveDottedPath } from "./resolve-dotted-path";
import { resolveWorkspacePath } from "./resolve-workspace-path";
import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolResult,
} from "./tool-types";

export type AiChatModelCaller = (
  systemPrompt: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal
) => Promise<{ content: string; toolCalls?: ToolCall[] }>;

// A chat session is a long multi-turn exchange; the budget guards against an
// agent that never signals completion.
const MAX_TURNS = 200;

export type AiChatRunnerConfig = {
  modelCaller: AiChatModelCaller;
  toolDefinitions: Record<string, ToolDefinition>;
  toolExecutors: Record<string, ToolExecutor>;
  completionTool?: string;
  completionSignal?: string;
  basePath?: string;
  instanceId?: string;
  patchWorkflowInstanceState?: (patch: Record<string, unknown>) => void;
  // The instance's domain data, resolved against by @instance: workspacePath
  // refs (e.g. "@instance:worktreePath").
  workflowInstanceState?: Record<string, unknown>;
  // Syncs the live conversation into the instance state at each turn boundary
  // so observers (the flow snapshot push) render the transcript as it grows.
  patchRunningTaskMessages?: (messages: ChatMessage[]) => void;
  // The create_instance capability, offered to the model when the task declares
  // the tool. Takes domain state and returns the new instance id.
  createWorkflowInstance?: (
    workflowId: string,
    instanceState?: Record<string, unknown>
  ) => { id: string };
};

export function createAiChatRunner(config: AiChatRunnerConfig): TaskRunner {
  const abortController = new AbortController();
  let messages: ChatMessage[] = [];
  let turnResolve: (() => void) | null = null;

  function waitForInput(): Promise<void> {
    return new Promise((resolve) => {
      turnResolve = resolve;
    });
  }

  function isComplete(
    task: TaskDefinition,
    content: string,
    toolCalls?: ToolCall[]
  ): boolean {
    const signal = task.completionSignal ?? config.completionSignal;
    if (signal && content.includes(signal)) {
      return true;
    }
    const completionTool = task.completionTool ?? config.completionTool;
    if (completionTool && toolCalls?.some((c) => c.name === completionTool)) {
      return true;
    }
    return false;
  }

  async function agentLoop(task: TaskDefinition): Promise<{ output: unknown }> {
    const workspacePath = resolveWorkspacePath(
      task.workspacePath,
      config.workflowInstanceState,
      config.basePath
    );
    const toolDefs = (task.tools ?? [])
      .map((name) => config.toolDefinitions[name])
      .filter(Boolean);

    for (let iteration = 0; iteration < MAX_TURNS; iteration++) {
      abortController.signal.throwIfAborted();

      const response = await config.modelCaller(
        task.systemPrompt ?? "",
        messages,
        toolDefs,
        abortController.signal
      );

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
      config.patchRunningTaskMessages?.(messages);

      if (isComplete(task, response.content, response.toolCalls)) {
        const completionCall = response.toolCalls?.find(
          (call) => call.name === (task.completionTool ?? config.completionTool)
        );
        return {
          output: {
            content: response.content,
            messages,
            toolCalls: response.toolCalls,
            // The completion tool's parsed arguments, surfaced for gates (e.g.
            // outcome: "already_satisfied" routes a card to review instead of
            // requiring committed work). Malformed arguments degrade to the
            // plain transcript rather than failing the session.
            ...(completionCall
              ? { completion: safeParseArguments(completionCall.arguments) }
              : {}),
          },
        };
      }

      if (!response.toolCalls?.length) {
        // Interactive sessions (startOnUserInput) wait for the user when the
        // model has no tool calls. Automated agents auto-reprompt so the
        // session never stalls waiting for human input.
        if (task.startOnUserInput) {
          await waitForInput();
        } else {
          const completionHint =
            task.completionTool !== undefined
              ? ` Call \`${task.completionTool}\` when the work is complete.`
              : "";
          messages.push({
            role: "user",
            content: `Continue working toward completion.${completionHint}`,
          });
          config.patchRunningTaskMessages?.(messages);
        }
        continue;
      }

      for (const call of response.toolCalls) {
        abortController.signal.throwIfAborted();
        const executor = config.toolExecutors[call.name];
        if (!executor) {
          messages.push({
            role: "tool",
            content: `Unknown tool: ${call.name}`,
            tool_call_id: call.id,
          });
          config.patchRunningTaskMessages?.(messages);
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
            signal: abortController.signal,
          });
        } catch (err) {
          // A throwing tool must not kill the whole session — surface the
          // failure to the model as a tool result so it can recover.
          messages.push({
            role: "tool",
            content: `Tool "${call.name}" failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
            tool_call_id: call.id,
          });
          config.patchRunningTaskMessages?.(messages);
          continue;
        }
        messages.push({
          role: "tool",
          content: result.content,
          tool_call_id: call.id,
        });
        config.patchRunningTaskMessages?.(messages);
      }
    }

    throw new Error("Iteration budget exhausted");
  }

  return {
    async run(task: TaskDefinition) {
      messages = [{ role: "system", content: task.systemPrompt ?? "" }];
      const injectedInput = resolveDottedPath(
        config.workflowInstanceState ?? {},
        task.inputFromInstanceState
      );
      if (injectedInput !== undefined) {
        messages.push({
          role: "user",
          content:
            typeof injectedInput === "string"
              ? injectedInput
              : JSON.stringify(injectedInput),
        });
      }
      config.patchRunningTaskMessages?.(messages);
      if (task.startOnUserInput) {
        // Wait for the first user message before calling the model, so a
        // transient provider failure cannot break the session before it
        // starts. The first sendMessage releases this.
        await waitForInput();
      }
      return await agentLoop(task);
    },

    cancel() {
      abortController.abort(new DOMException("Cancelled", "AbortError"));
      turnResolve?.();
      turnResolve = null;
    },

    async sendMessage(content: string, role: ChatMessage["role"]) {
      messages.push({ role, content });
      config.patchRunningTaskMessages?.(messages);
      turnResolve?.();
      turnResolve = null;
    },
  };
}

// Parses a completion tool's arguments into a plain record; returns {} when
// the arguments are not valid JSON so a malformed completion never fails the
// session (the transcript still carries the completion).
function safeParseArguments(argumentsText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
