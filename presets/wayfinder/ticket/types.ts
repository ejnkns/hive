// The ticket workflow's instance state type, self-contained for the referenced
// ticket ops (they cannot import types from the rendered entry).

export type TicketState = {
  title?: string;
  question?: string;
  type?: string;
  dependsOn?: string[];
  // Creation-time input from the Add fog entry form; normalized into
  // title/question by normalize_ticket and not part of the settled shape.
  brief?: string;
  // Whether a task-type ticket runs as a live ai-chat session (true) or an
  // AFK one-shot ai-task (false/absent).
  hitl?: boolean;
  // The charting agent's sharp-ticket marker: a fog ticket with graduated:
  // true auto-advances to the frontier (ready); fog entries omit it.
  graduated?: boolean;
  // Written by the engine's workspace ops (prepare_prototype_workspace); read
  // by @instance: worktree refs and merge_branch.
  worktreePath?: string;
  branchName?: string;
};
