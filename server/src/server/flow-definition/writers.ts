/** @private — the definition-level every-read-has-a-writer invariant. */

import type {
  DefinitionValidationContext,
  FlowDefinition,
} from "workflow-engine/workflow-types";
import { ENGINE_PROVIDED, engineOpWritesByName } from "./constants.ts";
import { collectGateStateReads } from "./gate.ts";

export function validateWriters(
  definition: FlowDefinition,
  context: DefinitionValidationContext,
  error: (path: string, message: string) => void
): void {
  // Cross-instance writes (E1): every flow-level op's writesAcross declares
  // the sibling-instance fields it patches on a target workflow. When a task
  // uses the op, those fields have a writer on the TARGET workflow — count
  // them there, mirroring how own-instance op writes count for the workflows
  // whose tasks use the op.
  const usedOps = new Set<string>();
  for (const wf of definition.workflows) {
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        for (const op of task.operations ?? []) {
          if (typeof op === "string") usedOps.add(op);
        }
      }
    }
  }
  const siblingWritesByWorkflow = new Map<string, Set<string>>();
  for (const op of definition.operations ?? []) {
    if (!usedOps.has(op.id)) continue;
    for (const decl of op.writesAcross ?? []) {
      let fields = siblingWritesByWorkflow.get(decl.workflow);
      if (!fields) {
        fields = new Set();
        siblingWritesByWorkflow.set(decl.workflow, fields);
      }
      for (const field of decl.fields) fields.add(field);
    }
  }

  // ── the missing-writer invariant, at the definition level ──
  for (const [wfIndex, wf] of definition.workflows.entries()) {
    const wfPath = `workflows[${wfIndex}]`;
    const stateTypes = context.instanceStateById.get(wf.id);
    const taskIds = context.taskIdsByWorkflow.get(wf.id);
    if (!stateTypes || !taskIds) continue;

    const writes: Set<string> = new Set();
    // 1. this workflow's patch ops and extractor writes
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        for (const field of Object.keys(task.patch ?? {})) writes.add(field);
        for (const field of task.extract?.fields ?? []) writes.add(field);
      }
    }
    // 2. engine ops used by this workflow's tasks that write state, plus
    //    flow-level custom ops and tools whose executors patch state (the
    //    definition declares their writes; the module-set schema-consistency
    //    check verifies them against the actual bodies).
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        for (const op of task.operations ?? []) {
          if (typeof op !== "string") continue;
          for (const field of engineOpWritesByName.get(op) ?? []) {
            writes.add(field);
          }
          for (const field of context.operationWritesById.get(op) ?? []) {
            writes.add(field);
          }
        }
        for (const tool of task.tools ?? []) {
          for (const field of context.toolWritesById.get(tool) ?? []) {
            writes.add(field);
          }
        }
      }
    }
    // 3. edges into this workflow
    for (const edge of definition.edges ?? []) {
      if (edge.toWorkflow !== wf.id) continue;
      for (const field of Object.keys(edge.fields ?? {})) writes.add(field);
      if (edge.fanOut) {
        for (const field of Object.keys(edge.fanOut.fields)) writes.add(field);
      }
      for (const field of edge.transform?.fields ?? []) writes.add(field);
    }
    // 4. createInstance payload keys into this workflow (state + flow level)
    for (const state of wf.states) {
      for (const action of state.actions ?? []) {
        if (action.createInstance?.workflowId === wf.id) {
          for (const field of action.createInstance.fields)
            writes.add(field.key);
        }
        // Manual-action input fields write the acting instance's state.
        for (const field of action.fields ?? []) writes.add(field.key);
      }
    }
    for (const action of definition.actions ?? []) {
      if (action.createInstance?.workflowId === wf.id) {
        for (const field of action.createInstance.fields) writes.add(field.key);
      }
    }
    // 5. editFields: the instance-edit form patches exactly these keys.
    for (const field of wf.editFields ?? []) writes.add(field.key);
    // 6. cross-instance writes into this workflow (E1): sibling ops whose
    //    writesAcross target this workflow write its fields from another
    //    instance.
    for (const field of siblingWritesByWorkflow.get(wf.id) ?? []) {
      writes.add(field);
    }

    const allWrites = new Set([...writes, ...ENGINE_PROVIDED]);
    const reads: Set<string> = new Set();

    for (const state of wf.states) {
      for (const transition of state.autoTransitions ?? []) {
        collectGateStateReads(transition.gate, reads);
      }
      for (const action of state.actions ?? []) {
        if (action.gate) collectGateStateReads(action.gate, reads);
        if (action.dependsOnState !== undefined) reads.add("dependsOn");
      }
      for (const task of state.tasks ?? []) {
        if (task.workspacePath?.startsWith("@instance:")) {
          reads.add(task.workspacePath.slice("@instance:".length));
        }
        if (task.inputFromInstanceState) {
          reads.add(task.inputFromInstanceState.split(".")[0]);
        }
      }
    }
    for (const key of ["title", "subtitle"] as const) {
      const value = wf.instance?.[key];
      if (value !== undefined) reads.add(value.split(".")[0]);
    }
    for (const field of wf.display?.fields ?? []) {
      reads.add(field.path.split(".")[0]);
    }
    // E3: the board partition reads the grouping field's values.
    if (wf.ui?.groupByField !== undefined) {
      reads.add(wf.ui.groupByField);
    }

    for (const field of reads) {
      if (allWrites.has(field)) continue;
      error(
        `${wfPath}`,
        `instance-state field "${field}" is read but nothing writes it (writers: patches, edges, createInstance payloads, engine ops; engine-provided: ${[...ENGINE_PROVIDED].join(", ")})`
      );
    }
    // dependsOnState implies the dependsOn field must be declared + written.
    const usesDependsOn = wf.states.some((s) =>
      (s.actions ?? []).some((a) => a.dependsOnState !== undefined)
    );
    if (usesDependsOn) {
      if (!stateTypes.has("dependsOn")) {
        error(
          `${wfPath}`,
          `dependsOnState is used but instanceState does not declare "dependsOn" (a string[] of instance ids/titles the engine resolves)`
        );
      } else if (!writes.has("dependsOn")) {
        error(
          `${wfPath}`,
          `dependsOnState is used but nothing writes "dependsOn" (write it from an edge or a patch op)`
        );
      }
    }
    void taskIds;
  }
}
