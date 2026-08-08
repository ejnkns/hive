/** @private — only imported by runners.ts */

import type { ChatMessage } from "../shared/chat-message";
import type { TaskDefinition, TaskRunner } from "../task-runner";
import { resolveDottedPath } from "./resolve-dotted-path";
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

// A one-shot task is expected to reach its completion tool in a few iterations;
// the budget guards against an agent stuck in a tool loop.
const MAX_ITERATIONS = 50;

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
  // The create_instance capability, offered to the model when the task declares
  // the tool. Takes domain state and returns the new instance id.
  createWorkflowInstance?: (
    workflowId: string,
    instanceState?: Record<string, unknown>
  ) => { id: string };
};

export function createAiTaskRunner(config: AiTaskRunnerConfig): TaskRunner {
  const abortController = new AbortController();

  return {
    async run(task: TaskDefinition) {
      const workspacePath = resolveWorkspacePath(
        task.workspacePath,
        config.workflowInstanceState,
        config.basePath
      );
      const toolDefs = (task.tools ?? [])
        .map((name) => config.toolDefinitions[name])
        .filter(Boolean);

      const messages: ChatMessage[] = [];
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

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
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
              createWorkflowInstance: config.createWorkflowInstance,
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
