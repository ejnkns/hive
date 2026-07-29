import type { FlowEdge } from "./workflow-types";

export type EdgeEffect = {
  fromWorkflow: string;
  toWorkflow: string;
  fromState: string;
  transformedData: Record<string, unknown>;
};

// Evaluates which FlowDefinition edges are activated by a state change.
// Returns a list of effects for each matching edge. The consumer
// (queen-bee runtime store) handles the side effects.
export function evaluateEdges(
  edges: FlowEdge[],
  fromWorkflow: string,
  newState: string,
  taskOutputs: Record<string, unknown>
): EdgeEffect[] {
  const effects: EdgeEffect[] = [];

  for (const edge of edges) {
    if (edge.fromWorkflow !== fromWorkflow) continue;
    if (!edge.fromStates.includes(newState)) continue;

    const transformedData = edge.transform
      ? edge.transform(taskOutputs as any)
      : {};

    effects.push({
      fromWorkflow: edge.fromWorkflow,
      toWorkflow: edge.toWorkflow,
      fromState: newState,
      transformedData,
    });
  }

  return effects;
}
