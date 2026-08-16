// The organize workflow's instance state type, self-contained for the
// referenced organize ops.

export type TaxonomyCategory = { name: string; definition: string };

export type OrganizeState = {
  name?: string;
  // The backlog digest (import sessions + every idea), assembled by
  // assemble_backlog_digest and seeded into the taxonomize task.
  backlogDigest?: string;
  // The proposed taxonomy, recorded from the taxonomize task and published
  // into flowState by publish_taxonomy.
  categories?: TaxonomyCategory[];
  priorityScale?: Record<string, unknown>;
  effortScale?: Record<string, unknown>;
  dedupPolicy?: string;
  // The classify-all input (taxonomy + every idea), assembled by
  // assemble_classify_input and seeded into the classifyAll task.
  classifyInput?: string;
};

export type IdeaClassification = {
  title: string;
  category: string;
  tags: string[];
  priority: string;
  effort: string;
  status: string;
  dependsOn: string[];
  duplicateOf: string;
  summary: string;
  rationale: string;
};
