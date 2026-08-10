/** @public — the deterministic renderer: FlowSpec → TypeScript flow definition.
 * Import from here, not from render-flow-definition/ directly.
 *
 * This is the convention-enforcing core of AI flow authoring. Instead of
 * asking a model to remember the schema-consistency check's conventions
 * (anchors, defineOperations maps, patchWorkflowInstanceState writes,
 * FlowEdge transforms, ctx.workflowInstanceState reads), the renderer emits
 * them *structurally* from a validated spec — so a rendered definition is
 * correct by construction and the check's errors, when they appear, are
 * real semantic errors, not convention drift.
 *
 * Conventions baked in:
 *   - `workflowInstanceState: {} as <Wf>ItemState` anchors, with the type
 *     alias derived from the spec's instanceState declaration;
 *   - ops emitted as exported `const <wfId>Operations = defineOperations<...>`
 *     maps (the check resolves ops through these), patch writes via
 *     `ctx.patchWorkflowInstanceState({ ... })` literals;
 *   - gates rendered as `(ctx) => ...` closures over
 *     `ctx.taskOutputs.<task>?.output?....` (optional chaining) and
 *     `ctx.workflowInstanceState.<field>`;
 *   - edges as `{ ... } satisfies FlowEdge` with transforms returning the
 *     mapped object literal;
 *   - `taskOutputs: {} as <Wf>TaskOutputs` typed with every task id and
 *     exactly the output shapes the gates reference (so gates typecheck and
 *     the whole module typechecks under the per-definition typechecker).
 *
 * The emitted module is erasable-syntax TS (no enums/namespaces/parameter
 * properties), imports only workflow-engine/workflow-types + runners, and
 * loads under Node's native type-stripping. */

export { renderFlowDefinition } from "./render-flow-definition/flow-renderer";
