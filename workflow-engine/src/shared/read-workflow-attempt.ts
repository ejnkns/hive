// The {attempt} placeholder in a persist path is per-workflow-attempt. Items
// that track attempts (e.g. cards) carry it in workflowInstanceState; others
// default to attempt 1.
export function readWorkflowAttempt(
  instanceState: Record<string, unknown>
): number {
  const raw = instanceState.attempt;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 1;
}
