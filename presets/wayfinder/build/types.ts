// The build-phase workflows' instance state types, self-contained for the
// referenced build ops (they cannot import types from the rendered entry).

// The domain data a build instance carries: the spec recorded by the submit_spec
// tool during the specing session. The spec is injected into the planner via
// inputFromInstanceState and persisted by finalize_spec. (Seams live inside the
// spec markdown, not as a separate state field.)
export type BuildState = {
  spec?: string;
};

// The domain data a build-item instance carries: the planned ticket seeded by
// the build→build-item fan-out, plus the engine-written workspace fields.
export type BuildTicketState = {
  ticket?: {
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
  };
  dependsOn?: string[];
  worktreePath?: string;
  branchName?: string;
};
