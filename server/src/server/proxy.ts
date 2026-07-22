/** @public — proxy module API. Import from here, not from proxy/ directly. */

export type { FlowEvent } from "shared/dashboard-types";
export { shutdown, start } from "./proxy/application-lifecycle";
export type { ProviderState } from "./proxy/get-provider-states";
export { getProviderStates } from "./proxy/get-provider-states";
export type { ChatCompletionResult } from "./proxy/handle-chat-completion";
export { handleChatCompletion } from "./proxy/handle-chat-completion";
export { getLastUsed } from "./proxy/last-used-state";
export { getProviders } from "./proxy/providers-state";
export { routingMemory } from "./proxy/routing-memory";
export { initServerState } from "./proxy/server-state";
export {
  getSessionSnapshot,
  recordCircuitBreak,
  recordFailoverAttempt,
  recordNodeDispatched,
  recordOverrideFailed,
  recordRequestReceived,
  recordResponseComplete,
  recordSelectionRound,
  recordStreamingStarted,
  recordThinkingStarted,
  recordTokenTick,
  recordToolAccumulating,
  setAggregatorCallbacks,
} from "./proxy/session-aggregator";
