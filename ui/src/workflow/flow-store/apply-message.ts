/** @private — only imported by flow-store.svelte.ts */

import type { FlowResponse, FlowWsMessage } from "../../flow-api";

// The pure store reducer: given the current flows and a push frame, returns the
// next flows array. Extracted from the store so the protocol logic is testable
// without the Svelte runtime.
export function applyMessage(
  flows: readonly FlowResponse[],
  message: FlowWsMessage
): FlowResponse[] {
  if (message.type === "init") return message.flows;
  if (message.type === "flow_snapshot") return upsert(flows, message.flow);
  if (message.type === "flow_deleted") {
    return flows.filter((flow) => flow.id !== message.flowId);
  }
  return [...flows];
}

function upsert(
  flows: readonly FlowResponse[],
  flow: FlowResponse
): FlowResponse[] {
  const index = flows.findIndex((existing) => existing.id === flow.id);
  if (index === -1) return [...flows, flow];
  return [...flows.slice(0, index), flow, ...flows.slice(index + 1)];
}
