/** @private — only imported by runners.ts */

import type { ChatMessage } from "../shared/chat-message.ts";
import type { TaskDefinition, TaskRunner } from "../task-runner.ts";
import {
  type AgentModelCaller,
  type AgentRunnerConfig,
  type AgentTurnBehavior,
  runAgentLoop,
  safeParseArguments,
  seedTranscript,
} from "./agent-loop.ts";

// The chat model-caller contract is the shared agent-loop caller; the alias
// keeps the public runner surface stable.
export type AiChatModelCaller = AgentModelCaller;

// A chat session is a long multi-turn exchange; the budget guards against an
// agent that never signals completion.
const MAX_TURNS = 200;

// The ai-chat runner adds the session concerns to the shared AI-runner
// capabilities.
export type AiChatRunnerConfig = AgentRunnerConfig & {
  completionSignal?: string;
  // Syncs the live conversation into the instance state at each turn boundary
  // so observers (the flow snapshot push) render the transcript as it grows.
  patchRunningTaskMessages?: (messages: ChatMessage[]) => void;
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

  return {
    async run(task: TaskDefinition) {
      messages = [];
      seedTranscript(messages, task, config.workflowInstanceState?.());
      config.patchRunningTaskMessages?.(messages);
      if (task.startOnUserInput) {
        // Wait for the first user message before calling the model, so a
        // transient provider failure cannot break the session before it
        // starts. The first sendMessage releases this.
        await waitForInput();
      }

      // The chat contract: the output wraps the transcript; completion via the
      // completion tool surfaces its parsed arguments (for gates) and via the
      // signal surfaces the transcript. When the model stops calling tools,
      // interactive sessions wait for the user; one-shot sessions reprompt so
      // they never stall waiting for human input.
      const behavior: AgentTurnBehavior = {
        onMessagesChanged: (m) => config.patchRunningTaskMessages?.(m),
        waitForInput,
        onComplete: (response, completionCall) => ({
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
        }),
        onNoToolCalls: async (_response, _messages, task) => {
          if (task.startOnUserInput) {
            return { action: "wait" };
          }
          const completionHint =
            task.completionTool !== undefined
              ? ` Call \`${task.completionTool}\` when the work is complete.`
              : "";
          return {
            action: "reprompt",
            message: `Continue working toward completion.${completionHint}`,
          };
        },
      };

      return {
        output: await runAgentLoop(task, messages, {
          ...config,
          signal: abortController.signal,
          behavior,
          maxIterations: MAX_TURNS,
        }),
      };
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
