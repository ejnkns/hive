import type { FlowEdge, TaskOutputMap } from "./workflow-types";

export type EdgeEffect = {
  fromWorkflow: string;
  toWorkflow: string;
  fromState: string;
  transformedData: Record<string, unknown>;
};

export function evaluateEdges(
  edges: FlowEdge[],
  fromWorkflow: string,
  newState: string,
  taskOutputs: Partial<TaskOutputMap<Record<string, unknown>>>
): EdgeEffect[] {
  const effects: EdgeEffect[] = [];

  for (const edge of edges) {
    if (edge.fromWorkflow !== fromWorkflow) continue;
    if (!edge.fromStates.includes(newState)) continue;

    const transformedData: Record<string, unknown> = edge.transform
      ? edge.transform(taskOutputs)
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
