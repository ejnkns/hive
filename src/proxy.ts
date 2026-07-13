/** @public — proxy module API. Import from here, not from proxy/ directly. */
export {
  executeProxyRequest,
  type FailoverContext,
} from "./proxy/execute-proxy-request";
export {
  emitFlowEvent,
  type FlowEvent,
  onFlowEvent,
} from "./proxy/flow-events";
export { mutateRequest } from "./proxy/mutate-request";
export { createProxyModelCaller } from "./proxy/proxy-model-caller";
export { ProxyResponse } from "./proxy/proxy-response";
export { routeRequest } from "./proxy/route-request";
export { routingMemory } from "./proxy/routing-memory";
export {
  getSessionSnapshot,
  onSessionPatch,
} from "./proxy/session-aggregator";
export type { ChatCompletionResult } from "./proxy/types";
