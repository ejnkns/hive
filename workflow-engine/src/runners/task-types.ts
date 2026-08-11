/** @public — the single source of the task shape. Both the authoring-side
 * `StateTaskDef` (typed per workflow, with render hints) and the runtime-side
 * `TaskDefinition` (what runners execute) are built from `TaskBase`, so the
 * two can never drift. Lives in the runners subtree (a leaf: imports only
 * tool-types) so workflow-types and task-runner can both consume it without a
 * type cycle. */

import type { ToolName } from "./tool-types.ts";

export type TaskRole = "ai-task" | "ai-chat" | "operation";

// The fields every task carries, whichever side of the erasure boundary it is
// authored on. `render` is authoring-only (the UI reads it from the served
// definition; runners never see it), so it lives on StateTaskDef, not here.
export type TaskBase = {
  id: string;
  label: string;
  trigger: "auto" | "manual";
  role: TaskRole;
  tools?: ToolName[];
  operations?: string[];
  operationInputs?: Record<string, unknown>;
  systemPrompt?: string;
  // The completion contract (how a task ends and what becomes its output):
  //   completionTool   — the agent calls this tool to end the task; the
  //                      parsed tool arguments become the task output.
  //                      Available to ai-task and ai-chat.
  //   completionSignal — the ai-chat agent ends the session by writing this
  //                      marker as the last line of its response; the
  //                      transcript becomes the task output. ai-chat only;
  //                      ignored by ai-task (which ends via completionTool).
  //   completesRunningTask (ManualAction) — the HUMAN ends a running ai-chat
  //                      session via a "Done" action; the transcript becomes
  //                      the task output.
  completionTool?: string;
  completionSignal?: string;
  startOnUserInput?: boolean;
  // A dotted path into the instance's workflowInstanceState resolved at task
  // start and injected as the first user message (e.g. the requirements
  // document for the planner). Mirrors TaskDefinition.inputFromInstanceState.
  inputFromInstanceState?: string;
  // A literal workspace directory or an "@instance:<field>" ref into the
  // workflow instance state (e.g. "@instance:worktreePath") that the ai
  // runners resolve before building the tool context.
  workspacePath?: string;
  // Written on successful completion to basePath/<domainDir>/<path>.
  // {instanceId} and {attempt} in path are substituted per workflow
  // instance. Format is inferred from the output: string becomes a text
  // file, object/array becomes JSON.
  persist?: { path: string };
};

// The erased runtime task the runners execute. `trigger` is dropped — it is
// controller-side only (startAutoTasks filters by it) and runners never see
// it. StateTaskDef members (TaskBase + typed id + render) are assignable to
// this — extra properties are fine for non-literal values, so the controller
// can hand a state task straight to a runner.
export type TaskDefinition = Omit<TaskBase, "trigger">;
