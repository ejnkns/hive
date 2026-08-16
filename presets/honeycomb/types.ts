// The honeycomb flowState shape, shared by the referenced files that read or
// write flowState. The definition declares flowState as `{ field: "taxonomy",
// type: "object" }` — the shallow declaration plus this richer type are the
// two halves of the contract: the validator checks write keys against the
// declaration; gates/ops bind this type for readable fields.

import type { TaxonomyCategory } from "./organize/types.ts";

// The published taxonomy (E2): written by publish_taxonomy into flowState,
// read by the per-idea classifier (read_taxonomy tool), the classify-input
// assembler, and the needs-classify gate. Fields are optional — the taxonomy
// does not exist until the human approves it.
export type Taxonomy = {
  categories?: TaxonomyCategory[];
  // The category names as plain strings, for the edit form's dynamic select
  // options (E4 — the resolver keeps only string values).
  categoryNames?: string[];
  priorityScale?: Record<string, unknown>;
  effortScale?: Record<string, unknown>;
  dedupPolicy?: string;
};

export type FlowState = {
  taxonomy?: Taxonomy;
};
