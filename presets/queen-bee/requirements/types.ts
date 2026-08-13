// The requirements workflow's instance state type, self-contained for the
// referenced requirements ops (they cannot import types from the rendered
// entry).

export type RequirementsState = {
  // The session's running output — written by the update_requirements_draft
  // tool (and cleared by clear_requirements_state), read by the approve gate
  // and injected into the planner via inputFromInstanceState.
  requirementsDraft?: string;
};
