/** @private — only imported by runners.ts */

import type { ChatMessage } from "../shared/chat-message.ts";
import type { TaskDefinition, TaskRunner } from "../task-runner.ts";
import type { ModelCallStatus } from "../workflow-types.ts";
import {
  type AgentTurnBehavior,
  runAgentLoop,
  seedTaskInput,
} from "./agent-loop.ts";
import type { ToolCall, ToolDefinition, ToolExecutor } from "./tool-types.ts";

export type AiTaskModelCaller = (
  systemPrompt: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal: AbortSignal,
  // Live model-call progress (routing → dispatched → thinking → streaming →
  // complete), reported by the caller into the running task context.
  onStatus?: (status: ModelCallStatus) => void
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
  // Live model-call progress into the running task context (see ModelCallStatus).
  patchRunningTaskStatus?: (status: ModelCallStatus) => void;
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
      const messages: ChatMessage[] = [];
      seedTaskInput(
        messages,
        config.workflowInstanceState,
        task.inputFromInstanceState
      );

      // A one-shot ai-task with neither a system prompt nor any seeded input
      // has nothing to work on. Calling the model anyway spends provider
      // calls on an effectively empty prompt (`[{role:"system",content:""}]`)
      // and can wedge the instance forever on a stream that never completes —
      // e.g. an auto-run task on an instance created with an empty payload,
      // restarted on every server boot. Fail fast so taskError gates route
      // the instance to an error/needs-review state instead of a zombie task.
      //
      // A declared input is the same contract one level up: an ai-task that
      // says inputFromInstanceState must actually receive it. An instance
      // created without it (an empty seed, an edge that forgot a field) has
      // nothing to work on, so fail fast there too instead of spending a
      // model call on an empty prompt.
      const declaredInputMissing =
        task.inputFromInstanceState !== undefined &&
        !messages.some((message) => message.role === "user");
      if (declaredInputMissing) {
        throw new Error(
          `ai-task "${task.id}" declares inputFromInstanceState "${task.inputFromInstanceState}" but the instance was created without it — seed the instance with that field`
        );
      }
      const hasPrompt = (task.systemPrompt ?? "").trim() !== "";
      const hasInput = messages.some(
        (message) => message.content.trim() !== ""
      );
      if (!hasPrompt && !hasInput) {
        throw new Error(
          `ai-task "${task.id}" has no system prompt and no input to work on — declare a systemPrompt or inputFromInstanceState`
        );
      }

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
          signal: abortController.signal,
          modelCaller: config.modelCaller,
          toolDefinitions: config.toolDefinitions,
          toolExecutors: config.toolExecutors,
          behavior,
          maxIterations: MAX_ITERATIONS,
          completionTool: config.completionTool,
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
      abortController.abort();
    },
  };
}
