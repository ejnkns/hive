/** @public — the flow-authoring blueprint: the structured description an AI emits
 * and the renderer turns into a TypeScript definition. Import from here, not
 * from flow-blueprint/ directly.
 *
 * The blueprint is deliberately a closed, validated vocabulary — no expression
 * language. Gates are structured predicates (`GateSpec`), values are a small
 * set of sources (`ValueSpec`), and anything outside the vocabulary fails
 * validation with a model-actionable message (the flow is then finished by
 * hand in the editor).
 *
 * Validation mirrors the schema-consistency check's invariants *at the blueprint
 * level* so the model gets precise feedback before anything is rendered:
 *   - identifiers must be valid TS identifiers (they become type names and
 *     property accesses);
 *   - every reference resolves (workflow/state/task ids, op names, tool
 *     names, transition targets, edge targets);
 *   - every instance-state read (gates, hints, inputFromInstanceState,
 *     @instance: refs, dependsOnState) has a writer (patch ops, edge fields,
 *     createInstance payload keys, engine ops) — engine-provided fields
 *     (worktreePath/branchName/attempt) are exempt;
 *   - every write is declared in the target workflow's instanceState;
 *   - completionTool is `complete_task` (the only completion tool the engine
 *     ships that needs no domain code).
 *
 * The implementation lives in flow-blueprint/: the type vocabulary (blueprint-types),
 * shared constants (blueprint-constants), the field/gate/value validators, and
 * the orchestrating validateFlowBlueprint with its delegated edge and
 * writer-invariant sections. */

export type {
  ActionSpec,
  AutoTransitionSpec,
  BlueprintError,
  CompletionOutputField,
  EdgeSpec,
  FanOutValueSpec,
  FieldType,
  FlowBlueprint,
  FlowLevelActionSpec,
  GateSpec,
  InstanceStateField,
  StateSpec,
  TaskSpec,
  ValueSpec,
  WorkflowSpec,
} from "./flow-blueprint/blueprint-types.ts";

export {
  analyzeFlowBlueprint,
  validateFlowBlueprint,
} from "./flow-blueprint/validate-flow-blueprint.ts";
