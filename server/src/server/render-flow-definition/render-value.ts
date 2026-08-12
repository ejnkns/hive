/** @private — ValueSpec → expression rendering for patch ops and edge
 * transforms (with the cast to the declared field type). */

import type { FieldType, ValueSpec } from "../flow-blueprint.ts";
import { castTo, json } from "./render-primitives.ts";

export function renderPatchValue(
  value: ValueSpec,
  fieldTypeName: FieldType
): string {
  switch (value.kind) {
    case "literal":
      return json(value.value);
    case "instanceId":
      return "ctx.instanceId";
    case "taskOutput":
      return `readPath(ctx.taskOutputs().${value.task}, ${json(value.path)}) ${castTo(fieldTypeName)}`;
  }
}

export function renderEdgeValue(
  value: ValueSpec,
  fieldTypeName: FieldType
): string {
  switch (value.kind) {
    case "literal":
      return json(value.value);
    case "instanceId":
      return "undefined"; // no instance id exists at edge time
    case "taskOutput":
      return `readPath(source.${value.task}, ${json(value.path)}) ${castTo(fieldTypeName)}`;
  }
}

// ─── the renderer ─────────────────────────────────────────────────────
