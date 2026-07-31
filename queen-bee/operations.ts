import type { OperationFn } from "workflow-engine/runners";

// === QUEEN BEE DOMAIN OPERATIONS ===
//
// Deterministic operations referenced by name in queen-bee workflow tasks.
// Infrastructure operations (prepare_worktree) ship in the engine; these are
// queen-bee-specific and belong to the preset. The engine invokes them
// without interpreting what they mean.

export const queenBeeOperations: Record<string, OperationFn> = {
  validate_completion: (_task, _params) => ({ ok: true }),
  build_review_package: (_task, _params) => ({ packageId: "placeholder" }),
};
