/** @private — the contract-typed stubs the renderer emits for every
 * blueprint-referenced module. Each stub declares the exact export the entry
 * imports with the exact contract the module-set lint checks — writing the
 * implementation is the only remaining work (the "implement" marker). Stubs
 * are emitted once per unique ref path; a file referenced twice shares one
 * stub. */

import type { FlowBlueprint } from "../flow-blueprint.ts";
import {
  collectModuleReferences,
  type ModuleReference,
} from "../flow-blueprint.ts";

export function renderReferenceStubs(
  blueprint: FlowBlueprint
): Record<string, string> {
  const files: Record<string, string> = {};
  const seen = new Set<string>();
  for (const ref of collectModuleReferences(blueprint)) {
    if (seen.has(ref.ref)) continue;
    seen.add(ref.ref);
    files[ref.ref] = renderStub(ref);
  }
  return files;
}

function renderStub(ref: ModuleReference): string {
  switch (ref.kind) {
    case "gate":
      return gateStub(ref.exportName);
    case "tool":
      return toolStub(ref.exportName, ref.id);
    case "operation":
      return operationStub(ref.exportName, ref.id);
    case "transform":
      return transformStub(ref.exportName);
    case "extract":
      return extractStub(ref.exportName);
  }
}

function gateStub(exportName: string): string {
  return `// @generated — blueprint-referenced gate. Implement the decision logic
// below; the entry imports this export by name: ${exportName}.
import type { GateContract } from "workflow-engine/workflow-types";

// TODO: implement — this stub always returns false
export const ${exportName}: GateContract = (ctx) => {
  return false;
};
`;
}

function toolStub(exportName: string, id: string): string {
  return `// @generated — blueprint-referenced tool. Implement the executor
// below; the entry imports this export by name: ${exportName}.
import { defineTool } from "workflow-engine/runners";

export const ${exportName} = [
  defineTool({
    name: "${id}",
    description:
      "TODO: implement ${id} — describe what this tool does and its parameters.",
    parameters: { properties: {}, required: [] },
    executor: async () => {
      throw new Error("${id} is not implemented");
    },
  }),
];
`;
}

function operationStub(exportName: string, id: string): string {
  return `// @generated — blueprint-referenced operation. Implement the op below;
// the entry imports this export by name: ${exportName}.
import { defineOperations, type OperationContext } from "workflow-engine/runners";

export const ${exportName} = defineOperations<Record<string, unknown>>({
  ${id}: (task, params, ctx: OperationContext) => {
    // TODO: implement — this stub returns ok
    return { ok: true };
  },
});
`;
}

function transformStub(exportName: string): string {
  return `// @generated — blueprint-referenced edge transform. Implement the
// transform below; the entry imports this export by name: ${exportName}.
import type { TransformContract } from "workflow-engine/workflow-types";

export const ${exportName}: TransformContract = (source) => {
  // TODO: implement — this stub passes nothing through
  return {};
};
`;
}

function extractStub(exportName: string): string {
  return `// @generated — blueprint-referenced output extractor. Implement the
// extractor below; the entry imports this export by name: ${exportName}.
import type { OutputExtractor } from "workflow-engine/workflow-types";

export const ${exportName}: OutputExtractor = (ctx) => {
  // TODO: implement — this stub extracts nothing
  return {};
};
`;
}
