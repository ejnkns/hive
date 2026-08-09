/** @private — only imported by runners.ts */

import type { ChatMessage } from "../shared/chat-message";
import type { TaskDefinition, TaskRunner } from "../task-runner";
import type { ModelCallStatus } from "../workflow-types";
import {
  type AgentTurnBehavior,
  runAgentLoop,
  safeParseArguments,
  seedTaskInput,
} from "./agent-loop";
import type { ToolCall, ToolDefinition, ToolExecutor } from "./tool-types";

export type AiChatModelCaller = (
  systemPrompt: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  // Live model-call progress (routing → dispatched → thinking → streaming →
  // complete), reported by the caller into the running task context.
  onStatus?: (status: ModelCallStatus) => void
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
  // Live model-call progress into the running task context (see ModelCallStatus).
  patchRunningTaskStatus?: (status: ModelCallStatus) => void;
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

  return {
    async run(task: TaskDefinition) {
      messages = [{ role: "system", content: task.systemPrompt ?? "" }];
      seedTaskInput(
        messages,
        config.workflowInstanceState,
        task.inputFromInstanceState
      );
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
          signal: abortController.signal,
          modelCaller: config.modelCaller,
          toolDefinitions: config.toolDefinitions,
          toolExecutors: config.toolExecutors,
          behavior,
          maxIterations: MAX_TURNS,
          completionTool: config.completionTool,
          completionSignal: config.completionSignal,
          basePath: config.basePath,
          instanceId: config.instanceId,
          patchWorkflowInstanceState: config.patchWorkflowInstanceState,
          patchRunningTaskStatus: config.patchRunningTaskStatus,
          workflowInstanceState: config.workflowInstanceState,
          createWorkflowInstance: config.createWorkflowInstance,
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
