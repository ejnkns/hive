/** @private — structured GateSpec → (ctx) => ... closure rendering. */

import type { GateSpec } from "../flow-blueprint.ts";
import { json } from "./render-primitives.ts";

export function renderGate(
  gate: GateSpec,
  fileGateBinding?: (ref: string) => string
): string {
  switch (gate.kind) {
    case "always":
      return "true";
    case "never":
      return "false";
    case "hasRunningTask":
      return "ctx.hasRunningTask";
    case "noRunningTask":
      return "!ctx.hasRunningTask";
    case "taskSuccess":
      return `ctx.taskOutputs.${gate.task}?.status === "success"`;
    case "taskError":
      return `ctx.taskOutputs.${gate.task}?.status === "error"`;
    case "taskOutputEquals": {
      // path is "output" or "output.<seg>.<seg>" — the outcome's output.
      const rest =
        gate.path === "output" ? "" : gate.path.slice("output.".length);
      const access =
        rest === ""
          ? "?.output"
          : `?.output${rest
              .split(".")
              .map((s) => `?.${s}`)
              .join("")}`;
      return `ctx.taskOutputs.${gate.task}${access} === ${json(gate.value)}`;
    }
    case "instanceStateEquals":
      return `ctx.workflowInstanceState.${gate.field} === ${json(gate.value)}`;
    case "errorCountAtLeast":
      return `(ctx.taskErrorCounts.${gate.task} ?? 0) >= ${gate.count}`;
    case "file":
      // The referenced gate function, called with the runtime context.
      return `${fileGateBinding?.(gate.ref) ?? gate.ref}(ctx)`;
    case "not":
      return `!(${renderGate(gate.gate, fileGateBinding)})`;
    case "and":
      return gate.gates
        .map((g) => `(${renderGate(g, fileGateBinding)})`)
        .join(" && ");
    case "or":
      return gate.gates
        .map((g) => `(${renderGate(g, fileGateBinding)})`)
        .join(" || ");
  }
}

// ─── derived task-output type ─────────────────────────────────────────
