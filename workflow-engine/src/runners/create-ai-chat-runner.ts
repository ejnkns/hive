/** @private — only imported by runners.ts */
import type { TaskDefinition, TaskRunner } from "../task-runner";
import type { ChatMessage } from "../workflow-types";
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
      config.workflowInstanceState
    );
    const toolDefs = (task.tools ?? [])
      .map((name) => config.toolDefinitions[name])
      .filter(Boolean);

    for (let iteration = 0; iteration < 200; iteration++) {
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

      if (isComplete(task, response.content, response.toolCalls)) {
        return {
          output: {
            content: response.content,
            messages,
            toolCalls: response.toolCalls,
          },
        };
      }

      if (!response.toolCalls?.length) {
        await waitForInput();
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
          continue;
        }
        let result: ToolResult;
        try {
          result = await executor(call, {
            workspacePath,
            basePath: config.basePath,
            instanceId: config.instanceId,
            patchWorkflowInstanceState: config.patchWorkflowInstanceState,
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
          continue;
        }
        messages.push({
          role: "tool",
          content: result.content,
          tool_call_id: call.id,
        });
      }
    }

    throw new Error("Iteration budget exhausted");
  }

  return {
    async run(task: TaskDefinition) {
      messages = [{ role: "system", content: task.systemPrompt ?? "" }];
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
      turnResolve?.();
      turnResolve = null;
    },
  };
}
