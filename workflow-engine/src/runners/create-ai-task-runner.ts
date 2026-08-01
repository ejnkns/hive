/** @private — only imported by runners.ts */
import type { TaskDefinition, TaskRunner } from "../task-runner";
import type { ToolCall, ToolDefinition, ToolExecutor } from "./tool-types";

export type AiTaskModelCaller = (
  systemPrompt: string,
  messages: { role: string; content: string }[],
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
};

export function createAiTaskRunner(config: AiTaskRunnerConfig): TaskRunner {
  const abortController = new AbortController();

  return {
    async run(task: TaskDefinition) {
      const toolDefs = (task.tools ?? [])
        .map((name) => config.toolDefinitions[name])
        .filter(Boolean);

      const messages: { role: string; content: string }[] = [];

      for (let iteration = 0; iteration < 50; iteration++) {
        abortController.signal.throwIfAborted();

        const response = await config.modelCaller(
          task.systemPrompt ?? "",
          messages,
          toolDefs,
          abortController.signal
        );

        messages.push({ role: "assistant", content: response.content });

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
            });
            continue;
          }

          const result = await executor(call, {
            workspacePath: task.workspacePath ?? process.cwd(),
            basePath: config.basePath,
            instanceId: config.instanceId,
            signal: abortController.signal,
          });
          messages.push({
            role: "tool",
            content: result.content,
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
