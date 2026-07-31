/** @private — only imported by runners.ts */
import type { TaskDefinition, TaskRunner } from "../task-runner";
import type { ToolCall, ToolDefinition, ToolExecutor } from "./tool-types";

export type AiChatModelCaller = (
  systemPrompt: string,
  messages: { role: string; content: string }[],
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
};

export function createAiChatRunner(config: AiChatRunnerConfig): TaskRunner {
  const abortController = new AbortController();
  let messages: { role: string; content: string }[] = [];
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
    if (
      config.completionTool &&
      toolCalls?.some((c) => c.name === config.completionTool)
    ) {
      return true;
    }
    return false;
  }

  async function agentLoop(task: TaskDefinition): Promise<{ output: unknown }> {
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

      messages.push({ role: "assistant", content: response.content });

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
          });
          continue;
        }
        const result = await executor(call, {
          workspacePath: task.workspacePath ?? process.cwd(),
          basePath: config.basePath,
          signal: abortController.signal,
        });
        messages.push({ role: "tool", content: result.content });
      }
    }

    throw new Error("Iteration budget exhausted");
  }

  return {
    async run(task: TaskDefinition) {
      messages = [{ role: "system", content: task.systemPrompt ?? "" }];
      return await agentLoop(task);
    },

    cancel() {
      abortController.abort(new DOMException("Cancelled", "AbortError"));
      turnResolve?.();
      turnResolve = null;
    },

    async sendMessage(content: string, role: string) {
      messages.push({ role, content });
      turnResolve?.();
      turnResolve = null;
    },
  };
}
