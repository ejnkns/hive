/** @private — the output extractor contract: the context a blueprint-referenced
 * extractor receives and the function shape it implements. */

// The context an output extractor runs with: the instance's completed task
// outcomes (so the extractor can shape a source task's raw output) and a live
// getter for the current instance state. The renderer's generated op calls
// the extractor with exactly this and merges the returned object into
// instance state via the declared fields.
export type ExtractContext = {
  taskOutputs: Record<string, unknown>;
  workflowInstanceState: () => Record<string, unknown>;
};

// The contract a blueprint-referenced output extractor implements: task
// outcomes + live instance state → the declared instance-state fields. The
// renderer emits stubs typed with this and the module-set lint checks the
// referenced export against it.
export type OutputExtractor = (ctx: ExtractContext) => Record<string, unknown>;
