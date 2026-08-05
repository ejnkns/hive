import type { ChatMessage } from "./workflow-types";

export type TaskDefinition = {
  id: string;
  label: string;
  role: string;
  tools?: string[];
  operations?: string[];
  operationInputs?: Record<string, unknown>;
  systemPrompt?: string;
  // See the completion contract on StateTaskDef (workflow-types.ts): the
  // completionTool is honored by ai-task and ai-chat; the completionSignal is
  // ai-chat only.
  completionTool?: string;
  completionSignal?: string;
  workspacePath?: string;
  // For ai-chat sessions: wait for the user's first message before the first
  // model call, instead of calling the model on start. Suits conversational
  // sessions (requirements/ideas) where the agent should react to the user,
  // not open the conversation itself.
  startOnUserInput?: boolean;
  // A dotted path into the instance's workflowInstanceState (e.g.
  // "requirementsDraft"). Resolved at task start and injected as the first
  // user message, so an agent receives runtime context (the requirements
  // document, a proposal) without reading files or calling a tool.
  inputFromInstanceState?: string;
  // Written on successful completion to basePath/<domainDir>/<path>.
  // {instanceId} and {attempt} in path are substituted per workflow instance.
  // Format is inferred from the output: string becomes a text file,
  // object/array becomes JSON.
  persist?: { path: string };
};

export type TaskRunner = {
  run(task: TaskDefinition): Promise<{ output: unknown }>;
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
  // Creates a new workflow instance in this flow (the capability behind the
  // create_instance infra tool, so an agent can spawn fresh instances — e.g.
  // graduate fog into new decision tickets). The instanceState becomes the new
  // instance's domain data; returns the new instance id.
  createWorkflowInstance(
    workflowId: string,
    instanceState?: Record<string, unknown>
  ): { id: string };
};

export type TaskRunnerFactory = (ctx: TaskRunnerContext) => TaskRunner;
