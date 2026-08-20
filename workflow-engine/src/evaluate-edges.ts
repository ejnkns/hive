import type { RuntimeFlowEdge } from "./workflow-types.ts";

export type EdgeEffect = {
  toWorkflow?: string;
  toFlowState?: boolean;
  transformedData: Record<string, unknown>;
  // autoDispatch edge (the declarative singleton-refresh primitive): when the
  // edge fires, the runtime dispatches the named action to every instance of
  // toWorkflow (creating one first when createIfNone is set and none exists);
  // transformedData seeds the created instance. One effect per firing edge —
  // never fanned out.
  autoDispatch?: { actionId: string; createIfNone?: boolean };
};

export function evaluateEdges(
  edges: RuntimeFlowEdge[],
  fromWorkflow: string,
  newState: string,
  workflowOutput: Record<string, unknown>
): EdgeEffect[] {
  const effects: EdgeEffect[] = [];

  for (const edge of edges) {
    if (edge.fromWorkflow !== fromWorkflow) continue;
    if (!edge.fromStates.includes(newState)) continue;

    // Edge transforms are authored against Partial<TaskOutputMap<TSourceOutputs>>
    // but invoked with the erased runtime output map. reduce() guarantees the
    // values are TaskOutcome-shaped, so the shape matches at runtime.
    const transformed = edge.transform
      ? edge.transform(
          workflowOutput as Parameters<
            NonNullable<RuntimeFlowEdge["transform"]>
          >[0]
        )
      : {};

    // An autoDispatch edge is one effect (create-if-none + dispatch-to-all);
    // the transform output seeds the created instance. Everything else fans
    // out: one effect per element, so the target workflow gets one instance
    // per element (e.g. one card per plan card).
    if (edge.autoDispatch !== undefined) {
      effects.push({
        toWorkflow: edge.toWorkflow,
        toFlowState: edge.toFlowState,
        transformedData: (Array.isArray(transformed)
          ? (transformed[0] ?? {})
          : transformed) as Record<string, unknown>,
        autoDispatch: edge.autoDispatch,
      });
      continue;
    }

    const items = Array.isArray(transformed) ? transformed : [transformed];
    for (const item of items) {
      effects.push({
        toWorkflow: edge.toWorkflow,
        toFlowState: edge.toFlowState,
        transformedData: item,
      });
    }
  }

  return effects;
}
