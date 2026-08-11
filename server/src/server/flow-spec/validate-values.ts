/** @private — ValueSpec / literal / createInstance value validators. */

import type { ConfigField } from "workflow-engine/workflow-types";
import { DOTTED_PATH } from "./spec-constants.ts";
import type {
  CompletionOutputField,
  FieldType,
  SpecError,
  ValueSpec,
  WorkflowSpec,
} from "./spec-types.ts";

export function validateValueSpec(
  value: ValueSpec,
  taskIds: Set<string>,
  path: string,
  // The source workflow's task id → completionOutput map; when present, reads
  // from a task with a structured completion contract must address a declared
  // field (the parsed completion arguments ARE the ai-task output).
  completionOutputByTask?: Map<string, CompletionOutputField[]>
): SpecError[] {
  const errors: SpecError[] = [];
  if (value.kind === "literal") return errors;
  if (value.kind === "instanceId") return errors;
  if (value.kind === "taskOutput") {
    if (!taskIds.has(value.task)) {
      errors.push({
        path,
        message: `value source reads task "${value.task}" which the workflow does not declare (tasks: ${[...taskIds].join(", ")})`,
      });
    }
    if (typeof value.path !== "string" || !DOTTED_PATH.test(value.path)) {
      errors.push({
        path,
        message: `taskOutput path must be a dotted path (got ${JSON.stringify(value.path)})`,
      });
      return errors;
    }
    const fields = completionOutputByTask?.get(value.task);
    if (fields !== undefined) {
      const segments = value.path.split(".");
      if (segments[0] !== "output") {
        errors.push({
          path,
          message: `taskOutput path must start with "output" (the task's outcome), got ${JSON.stringify(value.path)}`,
        });
      } else if (
        value.path !== "output" &&
        !fields.some((f) => f.field === segments[1])
      ) {
        errors.push({
          path,
          message: `taskOutput path ${JSON.stringify(value.path)} reads field "${segments[1]}" which task "${value.task}" does not declare in completionOutput (declared: ${fields.map((f) => f.field).join(", ")})`,
        });
      }
    }
  }
  return errors;
}

// A literal's runtime type must match the declared field type, or the
// rendered code fails to typecheck (`title: 3` vs `title?: string`).
export function checkLiteralMatches(
  value: string | number | boolean,
  fieldTypeName: FieldType,
  path: string
): SpecError[] {
  if (fieldTypeName === "object" || fieldTypeName.endsWith("[]")) {
    return [
      {
        path,
        message: `literal values cannot fill field type ${fieldTypeName} — use a taskOutput value source instead`,
      },
    ];
  }
  if (fieldTypeName !== typeof value) {
    return [
      {
        path,
        message: `literal ${JSON.stringify(value)} (${typeof value}) does not match field type ${fieldTypeName}`,
      },
    ];
  }
  return [];
}

export function validateCreateInstance(
  create: { workflowId: string; fields: ConfigField[] },
  workflowById: Map<string, WorkflowSpec>,
  instanceStateById: Map<string, Map<string, FieldType>>,
  path: string
): SpecError[] {
  const errors: SpecError[] = [];
  const target = workflowById.get(create.workflowId);
  if (!target) {
    errors.push({
      path,
      message: `createInstance targets unknown workflow ${JSON.stringify(create.workflowId)} (workflows: ${[...workflowById.keys()].join(", ")})`,
    });
    return errors;
  }
  const types = instanceStateById.get(target.id);
  if (!types) return errors;
  for (const field of create.fields) {
    if (!types.has(field.key)) {
      errors.push({
        path,
        message: `createInstance field "${field.key}" is not declared in workflow "${target.id}" instanceState (declared: ${[...types.keys()].join(", ")})`,
      });
    }
  }
  return errors;
}
