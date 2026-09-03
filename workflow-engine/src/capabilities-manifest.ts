/** @public — the engine's capability contract, as data.
 *
 * The single machine-readable description of what a flow definition gets from
 * the engine for free. An AI agent generating a flow (or a human skimming the
 * contract) reads this instead of the implementation: everything listed here
 * is a generic engine capability; a flow only declares its domain.
 *
 * Derived from the engine's own definitions wherever possible (infrastructure
 * tool names/descriptions come from createStandardToolDefinitions) so the
 * manifest cannot drift from the implementation. The schema-consistency check
 * consumes engineCapabilities.stateFields for its engine-provided set. */

import { createStandardToolDefinitions } from "./runners/create-standard-tool-registry.ts";

export const engineCapabilities = {
  // Task roles the engine runs. A task on a state declares one; the engine
  // provides the runner and the completion contract.
  taskRoles: ["ai-task", "ai-chat", "operation"] as const,

  // How a task ends and what becomes its output.
  completionContracts: [
    {
      name: "completionTool",
      description:
        "The agent calls this tool to end the task; the parsed tool arguments become the task output. ai-task and ai-chat.",
    },
    {
      name: "completionSignal",
      description:
        "The ai-chat agent ends the session by writing this marker as the last line of its response; the transcript becomes the task output. ai-chat only.",
    },
    {
      name: "completesRunningTask",
      description:
        "A ManualAction flag: the human ends a running ai-chat session via a Done action; the transcript becomes the task output.",
    },
    {
      name: "completionOutput",
      description:
        "An ai-task declares the structured fields it must return; the compiler generates a completion tool with those parameters, the agent calls it to end the task, and the parsed arguments become the task output (patch ops read output.<field>, gates compare output.<field>).",
    },
    {
      name: "newAttempt",
      description:
        "A ManualAction flag: the action starts a fresh attempt — the engine bumps the instance's `attempt` counter and discards the abandoned workspace in `worktreePath`. Engine-owned bookkeeping; a flow just declares the flag.",
    },
  ] as const,

  // Declarative output persistence. A task declares persist: { path }; the
  // engine owns path safety, format inference, and {instanceId}/{attempt}
  // substitution. Ops and tools never write files.
  persistence: {
    pathTemplates: ["{instanceId}", "{attempt}"],
    formatInference:
      "string output becomes a text file; object/array becomes JSON",
  } as const,

  // Deterministic error bookkeeping so flows bound retries declaratively.
  errorBookkeeping: {
    name: "taskErrorCounts",
    description:
      "Consecutive per-task error counter exposed to gates as ctx.taskErrorCounts; increments on a task's error, resets on its success. e.g. 'escalate after 3 failed validations'.",
  } as const,

  // Cross-instance capabilities: gates and actions can reference sibling
  // instances without any domain code, and operations can query and write
  // them.
  crossInstance: [
    "workflowInstancesInState(workflowId?, stateId?) — query instances from gates and ops, filtered by workflow and/or state; every result carries the instance's workflowId (E6)",
    'workflowInstancesInState("ideas") — every ideas instance; workflowInstancesInState(undefined, "done") — every done instance of any workflow',
    "maxWorkflowInstancesInTarget — engine-enforced concurrency limit on a ManualAction",
    "dependsOnState — engine backstop: resolves workflowInstanceState.dependsOn (ids or titles) against instances already in the target state",
  ] as const,

  // Cross-instance writes (E1): an operation on one instance patches another
  // instance's declared state. Same-flow only; the target workflow's declared
  // instanceState is the write contract.
  crossInstanceWrites: {
    name: "patchInstanceState(instanceId, patch)",
    description:
      "An OperationContext capability: patches a sibling instance's state from an operation running on this instance (same-flow only). Returns false for an unknown instance id (a NOOP the op handles — e.g. a stale title reference); throws when the patch carries a field the target workflow's instanceState does not declare. The write persists and emits events exactly like an own-instance patch. Declare every sibling write in the operation ref's `writesAcross: [{ workflow, fields }]` — the module-set gate rejects a sibling patch the operation does not declare, and the definition validator checks the fields against the target workflow's instanceState.",
  } as const,

  // Instance deletion (E5): a destructive state action removes the instance.
  instanceDeletion: {
    name: "deletesInstance",
    description:
      "A ManualAction flag (destructive variants only, mutually exclusive with transitionTo): when the action fires, the engine removes the instance from the flow — the controller is dropped, its persisted state is deleted, an instance_removed event is emitted, and the instance disappears from the board. No transition target is needed. Title-based references to a deleted instance go stale gracefully (a missing id is an unmet/unknown reference, never an error). The runtime API removeWorkflowInstance(instanceId) and the REST route DELETE /api/flows/:flowId/instances/:instanceId expose the same capability.",
  } as const,

  // Board grouping by field value (E3): a workflow ui hint partitions the
  // board by a declared instance-state field's distinct values.
  boardGrouping: {
    name: "ui.groupByField",
    description:
      'A workflow ui hint: `ui: { groupByField: "category" }` renders one board column per distinct value of that declared instance-state field, plus an Uncategorized column for instances missing the value. A GENERIC partition — the engine/UI never reads or interprets the values: no labels, ordering, or semantics (column ids/labels are the raw values); the domain maps values to labels via display hints if it wants. Mutually exclusive with ui.columns (field grouping replaces state columns).',
  } as const,

  // Flow-level state (E2): the flow's declared cross-entity state — read by
  // operations and tools, written by operations (patchFlowState).
  flowState: {
    name: "flowState",
    description:
      "The flow's declared cross-entity state (e.g. the shared taxonomy in honeycomb) — one place instead of duplicated on instances. The definition declares its `flowState` fields (field + type, like instanceState). Operations read it via ctx.flowState() and write it via ctx.patchFlowState(patch) (persists + emits flow_state_changed); tools read it via ctx.flowState. FlowState writes are validated like instance writes: the definition validator checks toFlowState edge transforms against the declaration, and the module-set gate checks operations' patchFlowState calls against it. Cross-entity data lives here; per-instance data stays on the instances.",
  } as const,

  // toFlowState edges (E2): an edge whose transform output updates flowState
  // instead of creating instances.
  toFlowStateEdges: {
    name: "toFlowState",
    description:
      "An EdgeSpec flag: when true, the edge's transform output updates FlowState instead of creating new instances. The transform's declared fields must be declared flowState fields (the validator enforces it). Edges (incl. toFlowState) fire only on terminal states — a flow that needs to write flowState mid-lifecycle uses a patchFlowState operation instead.",
  } as const,

  // autoDispatch edges (the declarative singleton-refresh primitive): a
  // terminal-state edge that dispatches an action to the target workflow's
  // instances, creating the target on first occurrence.
  autoDispatchEdges: {
    name: "autoDispatch",
    description:
      "An EdgeSpec declaration: `autoDispatch: { actionId, createIfNone }` on a terminal-state edge (e.g. imports done → organize). When the edge fires, the action is dispatched to EVERY instance of the target workflow through the same availability path as a manual click (state check + gates; an instance where the action is unavailable is a silent no-op). With `createIfNone`, the target instance is created first when none exists — the edge's `fields` seed its state and its initial-state auto-tasks run. Mutually exclusive with fanOut/transform (a refresh edge dispatches, it does not fan out); `fields` is allowed alongside. This makes 'refresh the singleton aggregate when work lands' a declarative primitive — edge effects apply in declaration order, so declare a refresh edge AFTER the edge that creates the work it reads.",
  } as const,

  // Runtime edit-field options (E4): a ConfigField sources its select options
  // from flowState at runtime instead of a static list.
  runtimeEditOptions: {
    name: "optionsFrom",
    description:
      'A ConfigField shape (edit fields, and by extension createInstance fields): `optionsFrom: { flowState: "taxonomy.categories" }` sources the field\'s select options from a dotted path into flowState at runtime — e.g. the AI-proposed category taxonomy drives the human edit UI. The first path segment must be a declared flowState field; mutually exclusive with static `options`. The server resolves the path to `options` when serializing instance entries (only string values become options); when flowState lacks the value the field falls back to free text (no options).',
  } as const,

  // The execution context a flow's own tools and operations receive: the
  // engine exposes live instance-state reads and writes, so a domain
  // capability can decide from the current state and record its result
  // without files or parameter plumbing.
  stateAccess: {
    name: "stateAccess",
    description:
      "Tools (defineTool executors) and operations (defineOperations) receive a live instance-state getter (ctx.workflowInstanceState()) and patch (ctx.patchWorkflowInstanceState(...)). The getter sees the current state — including patches from earlier turns, the flow, or the instance-state API — so a capability like an authoring session's save_definition can read the generated source and the id of a prior save instead of requiring every input as a parameter. Tools mirror the operation context; the generic engine never reads or writes files.",
  } as const,

  // State fields the engine itself writes and/or reads. engineProvided fields
  // need no preset writer; engineRead fields must be declared and written by
  // the flow. These are part of every workflow's implicit state contract.
  stateFields: {
    engineProvided: {
      worktreePath:
        "written by prepare_worktree (and flows' own workspace ops); read by verify_workspace, merge_branch, and @instance: workspacePath refs",
      branchName:
        "written by prepare_worktree; read by verify_workspace and merge_branch",
      attempt:
        "written by the newAttempt action flag; read by prepare_worktree, merge_branch, and {attempt} persist paths (unwritten counters default to 1)",
    },
    engineRead: {
      dependsOn:
        "read by the engine's dependsOnState backstop; written by the flow (edge transforms, createInstance payloads, normalize ops)",
    },
  } as const,

  // Infrastructure tools offered to every flow's agents, derived from the
  // registry so names/descriptions cannot drift.
  infrastructureTools: Object.values(createStandardToolDefinitions()).map(
    (definition) => ({
      name: definition.function.name,
      description: definition.function.description,
    })
  ),

  // Engine operations, resolved by name alongside a flow's domain operations.
  // State fields they read/write are part of the engine-provided contract.
  engineOperations: [
    {
      name: "prepare_worktree",
      description:
        "Prepare an isolated workspace: a git worktree on a feature branch when a repo is bound, a plain sandbox otherwise. Writes worktreePath/branchName; reads attempt.",
      reads: ["attempt"],
      writes: ["worktreePath", "branchName"],
    },
    {
      name: "verify_workspace",
      description:
        "Verify the isolated workspace accumulated the required work (operationInputs.require: committed | changes | none). Reads worktreePath/branchName.",
      reads: ["worktreePath", "branchName"],
      writes: [],
    },
    {
      name: "merge_branch",
      description:
        "No-ff merge a workflow instance's feature branch into the integration branch; discards the worktree and deletes the branch. Reads attempt/worktreePath.",
      reads: ["attempt", "worktreePath"],
      writes: [],
    },
    {
      name: "commit_flow_state",
      description:
        "Commit the declared domainDir to the integration branch. Explicit checkpoints only.",
      reads: [],
      writes: [],
    },
    {
      name: "validate_repo",
      description: "Validate a bound repository (exists, is git, has a HEAD).",
      reads: [],
      writes: [],
    },
  ] as const,

  // Render kinds the generic UI ships; a task's render hint resolves against
  // these (custom kinds are declared by the flow definition). `chips` renders
  // a single output-scoped array as inline pills (a display field declares it
  // with no props — the empty path binds the array prop to the root).
  renderKinds: ["markdown", "text", "card", "cards", "chips", "json"] as const,
} as const;

export type EngineCapabilities = typeof engineCapabilities;

// ─── authoring guide ──────────────────────────────────────────────────
//
// The manifest serialized for model prompts: the free surface an AI (or
// human) reads to author a flow definition without reading the engine source.
// Derived from the manifest itself so the prompt cannot drift from the
// implementation — a guard test asserts every op name, state field, and
// infrastructure tool name appears in the output.

export function authoringGuide(): string {
  const lines: string[] = [];
  const push = (text = "") => lines.push(text);

  push("HIVE WORKFLOW ENGINE — CAPABILITIES A FLOW GETS FOR FREE");
  push(
    "A flow definition declares only its domain. Everything listed here is generic engine machinery a flow uses by name. Engine-provided state fields need no flow writer; engine-read state fields must be declared and written by the flow."
  );
  push();

  push("## Task roles (a task's `role`)");
  for (const role of engineCapabilities.taskRoles) {
    push(`- ${role}`);
  }
  push();

  push("## How a task ends (completion contracts)");
  for (const contract of engineCapabilities.completionContracts) {
    push(`- ${contract.name} — ${contract.description}`);
  }
  push();

  push("## Declarative output persistence (task `persist: { path }`)");
  push(
    `- path templates: ${engineCapabilities.persistence.pathTemplates.join(", ")}`
  );
  push(`- format inference: ${engineCapabilities.persistence.formatInference}`);
  push();

  push("## Error bookkeeping (gates read `ctx.taskErrorCounts`)");
  push(
    `- ${engineCapabilities.errorBookkeeping.name} — ${engineCapabilities.errorBookkeeping.description}`
  );
  push();

  push("## Cross-instance capabilities (gates and ops)");
  for (const item of engineCapabilities.crossInstance) push(`- ${item}`);
  push();

  push("## Cross-instance writes (operations)");
  push(
    `- ${engineCapabilities.crossInstanceWrites.name} — ${engineCapabilities.crossInstanceWrites.description}`
  );
  push();

  push("## Instance deletion (state actions)");
  push(
    `- ${engineCapabilities.instanceDeletion.name} — ${engineCapabilities.instanceDeletion.description}`
  );
  push();

  push("## Board grouping by field value (workflow ui)");
  push(
    `- ${engineCapabilities.boardGrouping.name} — ${engineCapabilities.boardGrouping.description}`
  );
  push();

  push("## Flow-level state (flowState)");
  push(
    `- ${engineCapabilities.flowState.name} — ${engineCapabilities.flowState.description}`
  );
  push();

  push("## toFlowState edges");
  push(
    `- ${engineCapabilities.toFlowStateEdges.name} — ${engineCapabilities.toFlowStateEdges.description}`
  );
  push();

  push("## autoDispatch edges (refresh a singleton when work lands)");
  push(
    `- ${engineCapabilities.autoDispatchEdges.name} — ${engineCapabilities.autoDispatchEdges.description}`
  );
  push();

  push("## Runtime edit-field options (config fields)");
  push(
    `- ${engineCapabilities.runtimeEditOptions.name} — ${engineCapabilities.runtimeEditOptions.description}`
  );
  push();

  push("## Instance-state access in tools and ops");
  push(`- ${engineCapabilities.stateAccess.description}`);
  push();

  push("## Engine-provided state fields (no flow writer needed)");
  for (const [name, description] of Object.entries(
    engineCapabilities.stateFields.engineProvided
  )) {
    push(`- ${name} — ${description}`);
  }
  push();

  push(
    "## Engine-read state fields (must be declared and written by the flow)"
  );
  for (const [name, description] of Object.entries(
    engineCapabilities.stateFields.engineRead
  )) {
    push(`- ${name} — ${description}`);
  }
  push();

  push(
    "## Infrastructure tools (offered to every flow's agents; a task's `tools` lists the names)"
  );
  for (const tool of engineCapabilities.infrastructureTools) {
    push(`- ${tool.name} — ${tool.description}`);
  }
  push();

  push(
    "## Engine operations (resolved by name; a task's `operations` lists the names)"
  );
  for (const op of engineCapabilities.engineOperations) {
    const reads =
      op.reads.length > 0 ? ` reads: ${op.reads.join(", ")}` : " reads: none";
    const writes =
      op.writes.length > 0
        ? `; writes: ${op.writes.join(", ")}`
        : "; writes: none";
    push(`- ${op.name} — ${op.description}${reads}${writes}`);
  }
  push();

  push("## Render kinds (a task's `render` hint)");
  push(`- ${engineCapabilities.renderKinds.join(", ")}`);

  return lines.join("\n");
}
