/** @package — the schema-consistency report shapes (public through the
 * schema-consistency.ts entry).
 *
 * Detached from the exports below so biome's privacy model reads the module
 * doc as documentation, not a visibility tag on the symbols. */

export type SchemaCheckFile = { path: string; source: string };

export type WorkflowCheckResult = {
  workflowId: string;
  // Declared instance-state fields (sorted), undefined when no anchor.
  declared?: string[];
  reads: string[];
  writes: string[];
  errors: string[];
  warnings: string[];
};

export type CheckReport = {
  workflows: WorkflowCheckResult[];
  // All errors/warnings flattened in workflow order (generation feedback,
  // editor panel).
  errors: string[];
  warnings: string[];
};
