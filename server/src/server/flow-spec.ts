/** @public — the flow-authoring spec: the structured description an AI emits
 * and the renderer turns into a TypeScript definition. Import from here, not
 * from flow-spec/ directly.
 *
 * The spec is deliberately a closed, validated vocabulary — no expression
 * language. Gates are structured predicates (`GateSpec`), values are a small
 * set of sources (`ValueSpec`), and anything outside the vocabulary fails
 * validation with a model-actionable message (the flow is then finished by
 * hand in the editor).
 *
 * Validation mirrors the schema-consistency check's invariants *at the spec
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
 * The implementation lives in flow-spec/: the type vocabulary (spec-types),
 * shared constants (spec-constants), the field/gate/value validators, and
 * the orchestrating validateFlowSpec with its delegated edge and
 * writer-invariant sections. */

export type {
  ActionSpec,
  AutoTransitionSpec,
  CompletionOutputField,
  EdgeSpec,
  FanOutValueSpec,
  FieldType,
  FlowLevelActionSpec,
  FlowSpec,
  GateSpec,
  InstanceStateField,
  SpecError,
  StateSpec,
  TaskSpec,
  ValueSpec,
  WorkflowSpec,
} from "./flow-spec/spec-types";

export {
  analyzeFlowSpec,
  validateFlowSpec,
} from "./flow-spec/validate-flow-spec";
