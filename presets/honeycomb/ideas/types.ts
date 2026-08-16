// The ideas workflow's instance state type, self-contained for the
// referenced ideas ops.

export type IdeaState = {
  title?: string;
  originalText?: string;
  source?: string;
  category?: string;
  tags?: string[];
  priority?: string;
  effort?: string;
  status?: string;
  dependsOn?: string[];
  duplicateOf?: string;
  summary?: string;
  rationale?: string;
  dependents?: string[];
};
