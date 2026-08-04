/** @private — checks a resolved prop value against a render contract's declared type. */

import type { RenderPropType } from "workflow-engine/workflow-types";

export function valueMatchesType(
  value: unknown,
  type: RenderPropType
): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "string[]":
      return (
        Array.isArray(value) && value.every((item) => typeof item === "string")
      );
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "unknown":
      return true;
  }
}
