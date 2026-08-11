import type { TaskDefinition } from "./runners/task-types.ts";
import type { ChatMessage } from "./shared/chat-message.ts";
import type { ModelCallStatus } from "./workflow-types.ts";

// The runtime task shape lives in runners/task-types.ts (the single source);
// the authoring-side StateTaskDef in workflow-types.ts is built from the same
// TaskBase, so the two can never drift.
export type { TaskDefinition, TaskRole } from "./runners/task-types.ts";

export type TaskRunner = {
  run(task: TaskDefinition): Promise<{
    output: unknown;
  }>;
  cancel(): void;
  sendMessage?(content: string, role: string): Promise<void>;
};

// Runners that hold per-session mutable state (messages, abort signal) must
// be created per task execution so concurrent tasks in the same flow do not
// share state. A factory produces an isolated instance for each execution.
//
// The factory receives the task's runtime context — flow config and the
// workflow instance it belongs to — so deterministic operation tasks can read
// and patch flow state, and ai runners know which instance they serve.
export type TaskRunnerContext = {
  flowConfig: Record<string, unknown>;
  patchFlowConfig(patch: Record<string, unknown>): void;
  instanceId: string;
  workflowId: string;
  currentState: string;
  workflowInstanceState: Record<string, unknown>;
  patchWorkflowInstanceState(patch: Record<string, unknown>): void;
  // Completed task outputs on the instance, so operations can read sibling
  // tasks' results (e.g. finalize reading the draft session's output).
  taskOutputs: Record<string, unknown>;
  // ai-chat sessions sync their live transcript into the instance state so
  // observers see messages at each turn boundary.
  patchRunningTaskMessages(messages: ChatMessage[]): void;
  // Reports the live model-call status (routing → dispatched → thinking →
  // streaming → complete) into the running task context, so the UI can show
  // what the agent's current model call is doing.
  patchRunningTaskStatus(status: ModelCallStatus): void;
  // Creates a new workflow instance in this flow (the capability behind the
  // create_instance infra tool, so an agent can spawn fresh instances — e.g.
  // graduate fog into new decision tickets). The instanceState becomes the new
  // instance's domain data; returns the new instance id.
  createWorkflowInstance(
    workflowId: string,
    instanceState?: Record<string, unknown>
  ): { id: string };
  // Cross-instance query so operations can resolve title-based dependencies
  // to instance IDs and gates can reference specific instances.
  workflowInstancesInState(stateId?: string): {
    currentState: string;
    id: string;
    workflowInstanceState: Record<string, unknown>;
  }[];
};

export type TaskRunnerFactory = (ctx: TaskRunnerContext) => TaskRunner;
