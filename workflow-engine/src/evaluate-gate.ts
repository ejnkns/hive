/** @public — fail-safe gate evaluation. */

import type { RuntimeGateContext } from "./workflow-types.ts";

// Fail-safe gate evaluation: a gate that throws evaluates as false — "the
// condition is not met yet". A gate reads instance/flowState fields whose
// writers may not have run (e.g. needs-classify reads `category` before the
// classify pass writes it), and a throw from inside the task-completion
// reducer would corrupt the completing task into an error: the reducer's
// new state is discarded (stale running flag), the caller re-records the
// successful task as errored, and the re-evaluated gate throws out of the
// catch. The module-set typecheck catches typo'd field names, so a runtime
// throw means the gate read a field before it was written — the correct
// answer is "no", never a crash. Every gate evaluation site (auto-
// transitions, manual-action visibility, flow-level action gates) goes
// through this.
export function evaluateGate(
  gate: (ctx: RuntimeGateContext) => boolean,
  ctx: RuntimeGateContext
): boolean {
  try {
    return gate(ctx);
  } catch {
    return false;
  }
}
