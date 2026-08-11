/** @public — proxy module API. Import from here, not from proxy/ directly. */

export { shutdown, start } from "./proxy/application-lifecycle.ts";
export type { ProviderState } from "./proxy/get-provider-states.ts";
export { getProviderStates } from "./proxy/get-provider-states.ts";
export type { ChatCompletionResult } from "./proxy/handle-chat-completion.ts";
export { handleChatCompletion } from "./proxy/handle-chat-completion.ts";
export { getLastUsed } from "./proxy/last-used-state.ts";
export { getProviders } from "./proxy/providers-state.ts";
export { routingMemory } from "./proxy/routing-memory.ts";
export { initServerState } from "./proxy/server-state.ts";
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
} from "./proxy/session-aggregator.ts";
