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
  // instances without any domain code.
  crossInstance: [
    "workflowInstancesInState(stateId?) — query instances by state from gates and ops",
    "maxWorkflowInstancesInTarget — engine-enforced concurrency limit on a ManualAction",
    "dependsOnState — engine backstop: resolves workflowInstanceState.dependsOn (ids or titles) against instances already in the target state",
  ] as const,

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
      name: "patch_flow_config",
      description:
        "Write fields into FlowConfig from within a task; @flow:<field> copies a current config value.",
      reads: [],
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
  // these (custom kinds are declared by the flow definition).
  renderKinds: ["markdown", "text", "card", "cards", "json"] as const,
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
