/** @private — the normalized reference inventory of a blueprint: every
 * blueprint-referenced module with its kind, path, and the symbol the entry
 * imports. The renderer (imports + wiring), the stub generator, and the
 * module-set lint all consume this single inventory so the three never drift.
 *
 * A reference appears exactly once per use site (a gate file ref nested in
 * not/and/or is one reference at that gate's path; the same file referenced
 * by two transitions is two references — the renderer dedupes imports by
 * module path, the lint reports each site). */

import type { FlowBlueprint, GateSpec } from "./blueprint-types.ts";
import { fileBaseName, refExportName } from "./validate-ref.ts";

export type ModuleReference =
  | {
      kind: "gate";
      ref: string;
      exportName: string;
      // The blueprint path of the gate (e.g. "workflows[0].states[0].autoTransitions[1].gate").
      path: string;
    }
  | {
      kind: "tool";
      ref: string;
      exportName: string;
      id: string;
      path: string;
    }
  | {
      kind: "operation";
      ref: string;
      exportName: string;
      id: string;
      path: string;
    }
  | {
      kind: "transform";
      ref: string;
      exportName: string;
      fields: string[];
      path: string;
    }
  | {
      kind: "extract";
      ref: string;
      exportName: string;
      fields: string[];
      workflowId: string;
      taskId: string;
      path: string;
    };

export function collectModuleReferences(
  blueprint: FlowBlueprint
): ModuleReference[] {
  const out: ModuleReference[] = [];
  const gateRefs = (gate: GateSpec, path: string): void => {
    if (gate.kind === "file") {
      out.push({
        kind: "gate",
        ref: gate.ref,
        exportName: refExportName("gate", { ref: gate.ref }),
        path,
      });
      return;
    }
    if (gate.kind === "not") {
      gateRefs(gate.gate, `${path}.gate`);
      return;
    }
    if (gate.kind === "and" || gate.kind === "or") {
      for (const [i, g] of gate.gates.entries()) {
        gateRefs(g, `${path}.gates[${i}]`);
      }
    }
  };

  for (const [wfIndex, wf] of blueprint.workflows.entries()) {
    const wfPath = `workflows[${wfIndex}]`;
    for (const [sIndex, state] of wf.states.entries()) {
      const sPath = `${wfPath}.states[${sIndex}]`;
      for (const [tIndex, transition] of (
        state.autoTransitions ?? []
      ).entries()) {
        gateRefs(transition.gate, `${sPath}.autoTransitions[${tIndex}].gate`);
      }
      for (const [aIndex, action] of (state.actions ?? []).entries()) {
        if (action.gate) {
          gateRefs(action.gate, `${sPath}.actions[${aIndex}].gate`);
        }
      }
      for (const [tIndex, task] of (state.tasks ?? []).entries()) {
        const tPath = `${sPath}.tasks[${tIndex}]`;
        for (const op of task.operations ?? []) {
          if (typeof op === "string") continue;
          out.push({
            kind: "operation",
            ref: op.ref,
            exportName: refExportName("operation", { ref: op.ref }),
            id: opNameOf(op.ref),
            path: `${tPath}.operations`,
          });
        }
        if (task.extract) {
          out.push({
            kind: "extract",
            ref: task.extract.ref,
            exportName: refExportName("extract", { ref: task.extract.ref }),
            fields: task.extract.fields,
            workflowId: wf.id,
            taskId: task.id,
            path: `${tPath}.extract`,
          });
        }
      }
    }
  }

  for (const [tIndex, tool] of (blueprint.tools ?? []).entries()) {
    out.push({
      kind: "tool",
      ref: tool.ref,
      exportName: refExportName("tool", { id: tool.id, ref: tool.ref }),
      id: tool.id,
      path: `tools[${tIndex}]`,
    });
  }
  for (const [oIndex, op] of (blueprint.operations ?? []).entries()) {
    out.push({
      kind: "operation",
      ref: op.ref,
      exportName: refExportName("operation", { id: op.id, ref: op.ref }),
      id: op.id,
      path: `operations[${oIndex}]`,
    });
  }
  for (const [eIndex, edge] of (blueprint.edges ?? []).entries()) {
    if (edge.transform) {
      out.push({
        kind: "transform",
        ref: edge.transform.ref,
        exportName: refExportName("transform", { ref: edge.transform.ref }),
        fields: edge.transform.fields,
        path: `edges[${eIndex}].transform`,
      });
    }
  }
  return out;
}

// The op name an inline task operation reference registers under: the file
// base name of the ref (`./ops/annotate.ts` → `annotate`). Tasks reference
// the op by this name; the stub exports the `<name>Operations` map.
export function opNameOf(ref: string): string {
  return fileBaseName(ref);
}
