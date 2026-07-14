/** @public — proxy module API. Import from here, not from proxy/ directly. */

export { initCore } from "./proxy/core-context";
export type { FlowEvent } from "./proxy/flow-events";
export { onFlowEvent } from "./proxy/flow-events";
export type { ProviderState } from "./proxy/get-provider-states";
export { getProviderStates } from "./proxy/get-provider-states";
export { handleChatCompletion } from "./proxy/handle-chat-completion";
export { getLastUsed } from "./proxy/last-used-state";
export { shutdown, start } from "./proxy/lifecycle";
export { getProviders } from "./proxy/providers-state";
export { routingMemory } from "./proxy/routing-memory";
export { getSessionSnapshot, onSessionPatch } from "./proxy/session-aggregator";
export type { ChatCompletionResult } from "./proxy/types";
