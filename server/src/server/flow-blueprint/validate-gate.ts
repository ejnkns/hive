/** @private — structured gate (GateSpec) validation and read collection. */

import type { BlueprintError, FieldType, GateSpec } from "./blueprint-types.ts";
import { validateRefShape } from "./validate-ref.ts";

export function collectGateTaskReads(gate: GateSpec, reads: Set<string>): void {
  switch (gate.kind) {
    // Only gates that compare the task's OUTPUT count as output reads; status
    // gates (taskSuccess/taskError) read the outcome envelope, not the data.
    case "taskOutputEquals":
      reads.add(gate.task);
      break;
    case "not":
      collectGateTaskReads(gate.gate, reads);
      break;
    case "and":
    case "or":
      for (const g of gate.gates) collectGateTaskReads(g, reads);
      break;
    default:
      break;
  }
}

// ── helper validators ─────────────────────────────────────────────────

export function validateGateSpec(
  gate: GateSpec,
  taskIds: Set<string>,
  stateTypes: Map<string, FieldType>,
  path: string
): BlueprintError[] {
  const errors: BlueprintError[] = [];
  const error = (p: string, message: string) =>
    errors.push({ path: p, message });

  switch (gate.kind) {
    case "always":
    case "never":
    case "hasRunningTask":
    case "noRunningTask":
      break;
    case "taskSuccess":
    case "taskError":
      if (!taskIds.has(gate.task)) {
        error(
          path,
          `gate references task "${gate.task}" which the workflow does not declare (tasks: ${[...taskIds].join(", ")})`
        );
      }
      break;
    case "taskOutputEquals":
      if (!taskIds.has(gate.task)) {
        error(
          path,
          `gate references task "${gate.task}" which the workflow does not declare (tasks: ${[...taskIds].join(", ")})`
        );
      }
      if (
        typeof gate.path !== "string" ||
        !(gate.path === "output" || gate.path.startsWith("output."))
      ) {
        error(
          path,
          `taskOutputEquals path must be "output" or "output.<segment>..." (got ${JSON.stringify(gate.path)})`
        );
      }
      break;
    case "instanceStateEquals": {
      const type = stateTypes.get(gate.field);
      if (type === undefined) {
        error(
          path,
          `gate reads instance-state field "${gate.field}" which is not declared (declared: ${[...stateTypes.keys()].join(", ")})`
        );
      } else if (type.endsWith("[]") || type === "object") {
        error(
          path,
          `gate compares instance-state field "${gate.field}" (type ${type}) with a scalar — use taskOutputEquals or a patch op instead`
        );
      } else if (type !== typeof gate.value) {
        error(
          path,
          `gate compares instance-state field "${gate.field}" (type ${type}) with a ${typeof gate.value} value`
        );
      }
      break;
    }
    case "errorCountAtLeast":
      if (!taskIds.has(gate.task)) {
        error(
          path,
          `gate references task "${gate.task}" which the workflow does not declare (tasks: ${[...taskIds].join(", ")})`
        );
      }
      break;
    case "file":
      for (const e of validateRefShape(gate.ref, `${path}.ref`)) {
        errors.push(e);
      }
      break;
    case "not":
      for (const e of validateGateSpec(
        gate.gate,
        taskIds,
        stateTypes,
        `${path}.gate`
      )) {
        errors.push(e);
      }
      break;
    case "and":
    case "or":
      if (!Array.isArray(gate.gates) || gate.gates.length === 0) {
        error(path, `${gate.kind} requires a non-empty gates array`);
      } else {
        gate.gates.forEach((g, i) => {
          for (const e of validateGateSpec(
            g,
            taskIds,
            stateTypes,
            `${path}.gates[${i}]`
          )) {
            errors.push(e);
          }
        });
      }
      break;
    default: {
      const exhaustive: never = gate;
      error(path, `unknown gate kind ${JSON.stringify(exhaustive)}`);
    }
  }
  return errors;
}

export function collectGateStateReads(
  gate: GateSpec,
  reads: Set<string>
): void {
  switch (gate.kind) {
    case "instanceStateEquals":
      reads.add(gate.field);
      break;
    case "not":
      collectGateStateReads(gate.gate, reads);
      break;
    case "and":
    case "or":
      for (const g of gate.gates) collectGateStateReads(g, reads);
      break;
    default:
      break;
  }
}
