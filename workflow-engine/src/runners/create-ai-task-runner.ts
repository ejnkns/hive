/** @private — only imported by runners.ts */

import type { ChatMessage } from "../shared/chat-message.ts";
import type { TaskDefinition, TaskRunner } from "../task-runner.ts";
import {
  type AgentModelCaller,
  type AgentRunnerConfig,
  type AgentTurnBehavior,
  runAgentLoop,
  seedTranscript,
} from "./agent-loop.ts";

// The one-shot model-caller contract is the shared agent-loop caller; the
// alias keeps the public runner surface stable.
export type AiTaskModelCaller = AgentModelCaller;

// A one-shot task is expected to reach its completion tool in a few iterations;
// the budget guards against an agent stuck in a tool loop.
const MAX_ITERATIONS = 50;

// The ai-task runner takes the shared AI-runner capabilities unchanged.
export type AiTaskRunnerConfig = AgentRunnerConfig;

export function createAiTaskRunner(config: AiTaskRunnerConfig): TaskRunner {
  const abortController = new AbortController();

  return {
    async run(task: TaskDefinition) {
      const messages: ChatMessage[] = [];
      seedTranscript(messages, task, config.workflowInstanceState?.());

      // The pre-flight guards (no prompt and no input; declared input missing)
      // live in the shared loop — see assertWorkableInput in agent-loop.ts.

      // The one-shot contract: the completion tool's raw arguments are the
      // output; a no-tool-call response means the agent finished and the
      // transcript is the output.
      const behavior: AgentTurnBehavior = {
        onComplete: (_response, completionCall) => {
          if (completionCall === undefined) {
            throw new Error("ai-task completed without a completion tool call");
          }
          return JSON.parse(completionCall.arguments);
        },
        onNoToolCalls: async (response) => ({
          action: "return",
          output: { content: response.content, messages },
        }),
      };

      return {
        output: await runAgentLoop(task, messages, {
          ...config,
          signal: abortController.signal,
          behavior,
          maxIterations: MAX_ITERATIONS,
        }),
      };
    },

    cancel() {
      abortController.abort();
    },
  };
}
