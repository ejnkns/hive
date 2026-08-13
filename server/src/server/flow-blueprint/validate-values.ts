/** @private — ValueSpec / literal / createInstance value validators. */

import type { ConfigField } from "workflow-engine/workflow-types";
import { DOTTED_PATH } from "./blueprint-constants.ts";
import type {
  BlueprintError,
  CompletionContract,
  FieldType,
  ValueSpec,
  WorkflowSpec,
} from "./blueprint-types.ts";

// Where a task's structured completion fields surface in its output depends
// on the role: an ai-task's output IS the parsed completion arguments
// (`output.<field>`); an ai-chat wraps them next to the transcript
// (`output.completion.<field>`). These helpers keep every read of a
// completion-contract task (patch/edge values and taskOutputEquals gates)
// addressing exactly the declared fields through the role's wrapper.

// The declared field a task-output read addresses, or undefined when the read
// is not field-addressed (the whole output / whole completion).
export function completionReadField(
  contract: CompletionContract,
  path: string
): string | undefined {
  const prefix = contract.role === "ai-task" ? "output." : "output.completion.";
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length).split(".")[0];
  }
  return undefined;
}

// An error message when the read does not address the contract's declared
// fields through the role's wrapper, or undefined when it is valid.
export function completionReadPathError(
  contract: CompletionContract,
  path: string
): string | undefined {
  const declared = contract.fields.map((f) => f.field).join(", ");
  if (path === "output") return undefined;
  if (contract.role === "ai-task") {
    if (path.startsWith("output.")) {
      const field = completionReadField(contract, path);
      return field !== undefined &&
        contract.fields.some((f) => f.field === field)
        ? undefined
        : `taskOutput path ${JSON.stringify(path)} reads field "${field}" which task does not declare in completionOutput (declared: ${declared})`;
    }
    return `taskOutput path must start with "output" (the task's outcome), got ${JSON.stringify(path)}`;
  }
  if (path === "output.completion") return undefined;
  if (path.startsWith("output.completion.")) {
    const field = completionReadField(contract, path);
    return field !== undefined && contract.fields.some((f) => f.field === field)
      ? undefined
      : `taskOutput path ${JSON.stringify(path)} reads completion field "${field}" which task does not declare in completionOutput (declared: ${declared})`;
  }
  return `an ai-chat completion contract surfaces its fields at output.completion.<field> (got ${JSON.stringify(path)}) — an ai-chat task's output is the transcript with the parsed completion arguments nested under "completion"`;
}

export function validateValueSpec(
  value: ValueSpec,
  taskIds: Set<string>,
  path: string,
  // The source workflow's task id → completion contract map; when present,
  // reads from a task with a structured completion contract must address a
  // declared field through the role's wrapper (the parsed completion arguments
  // ARE the ai-task output, or the ai-chat output's `completion`).
  completionOutputByTask?: Map<string, CompletionContract>
): BlueprintError[] {
  const errors: BlueprintError[] = [];
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
    const contract = completionOutputByTask?.get(value.task);
    if (contract !== undefined) {
      const readError = completionReadPathError(contract, value.path);
      if (readError !== undefined) errors.push({ path, message: readError });
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
): BlueprintError[] {
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
): BlueprintError[] {
  const errors: BlueprintError[] = [];
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
