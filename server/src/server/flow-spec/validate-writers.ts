/** @private — the spec-level every-read-has-a-writer invariant. */

import { ENGINE_PROVIDED, engineOpWritesByName } from "./spec-constants.ts";
import type { FlowSpec, SpecValidationContext } from "./spec-types.ts";
import { collectGateStateReads } from "./validate-gate.ts";

export function validateWriters(
  spec: FlowSpec,
  context: SpecValidationContext,
  error: (path: string, message: string) => void
): void {
  // ── the missing-writer invariant, at the spec level ──
  for (const [wfIndex, wf] of spec.workflows.entries()) {
    const wfPath = `workflows[${wfIndex}]`;
    const stateTypes = context.instanceStateById.get(wf.id);
    const taskIds = context.taskIdsByWorkflow.get(wf.id);
    if (!stateTypes || !taskIds) continue;

    const writes: Set<string> = new Set();
    // 1. this workflow's patch ops
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        for (const field of Object.keys(task.patch ?? {})) writes.add(field);
      }
    }
    // 2. engine ops used by this workflow's tasks that write state
    for (const state of wf.states) {
      for (const task of state.tasks ?? []) {
        for (const op of task.operations ?? []) {
          for (const field of engineOpWritesByName.get(op) ?? []) {
            writes.add(field);
          }
        }
      }
    }
    // 3. edges into this workflow
    for (const edge of spec.edges ?? []) {
      if (edge.toWorkflow !== wf.id) continue;
      for (const field of Object.keys(edge.fields ?? {})) writes.add(field);
      if (edge.fanOut) {
        for (const field of Object.keys(edge.fanOut.fields)) writes.add(field);
      }
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
    for (const action of spec.actions ?? []) {
      if (action.createInstance?.workflowId === wf.id) {
        for (const field of action.createInstance.fields) writes.add(field.key);
      }
    }
    // 5. editFields: the instance-edit form patches exactly these keys.
    for (const field of wf.editFields ?? []) writes.add(field.key);

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
