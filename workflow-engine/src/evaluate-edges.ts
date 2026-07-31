import type { RuntimeFlowEdge } from "./workflow-types";

export type EdgeEffect = {
  fromWorkflow: string;
  toWorkflow?: string;
  toFlowState?: boolean;
  fromState: string;
  transformedData: Record<string, unknown>;
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
    const transformedData: Record<string, unknown> = edge.transform
      ? edge.transform(
          workflowOutput as Parameters<
            NonNullable<RuntimeFlowEdge["transform"]>
          >[0]
        )
      : {};

    effects.push({
      fromWorkflow: edge.fromWorkflow,
      toWorkflow: edge.toWorkflow,
      toFlowState: edge.toFlowState,
      fromState: newState,
      transformedData,
    });
  }

  return effects;
}
