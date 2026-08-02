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

export type AiTaskModelCaller = (
  systemPrompt: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal
) => Promise<{ content: string; toolCalls?: ToolCall[] }>;

export type AiTaskRunnerConfig = {
  modelCaller: AiTaskModelCaller;
  toolDefinitions: Record<string, ToolDefinition>;
  toolExecutors: Record<string, ToolExecutor>;
  completionTool?: string;
  basePath?: string;
  instanceId?: string;
  patchWorkflowInstanceState?: (patch: Record<string, unknown>) => void;
  // The instance's domain data, resolved against by @instance: workspacePath
  // refs (e.g. "@instance:worktreePath").
  workflowInstanceState?: Record<string, unknown>;
};

export function createAiTaskRunner(config: AiTaskRunnerConfig): TaskRunner {
  const abortController = new AbortController();

  return {
    async run(task: TaskDefinition) {
      const workspacePath = resolveWorkspacePath(
        task.workspacePath,
        config.workflowInstanceState
      );
      const toolDefs = (task.tools ?? [])
        .map((name) => config.toolDefinitions[name])
        .filter(Boolean);

      const messages: ChatMessage[] = [];

      for (let iteration = 0; iteration < 50; iteration++) {
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

        const completionTool = task.completionTool ?? config.completionTool;
        const completionCall = response.toolCalls?.find(
          (c) => c.name === completionTool
        );
        if (completionCall) {
          return { output: JSON.parse(completionCall.arguments) };
        }

        if (!response.toolCalls?.length) {
          return { output: { content: response.content, messages } };
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
    },

    cancel() {
      abortController.abort();
    },
  };
}
