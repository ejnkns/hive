/** @public — proxy module API. Import from here, not from proxy/ directly. */

export { initCore } from "./core-context";
export type { FlowEvent } from "./flow-events";
export { onFlowEvent } from "./flow-events";
export type { ProviderState } from "./get-provider-states";
export { getProviderStates } from "./get-provider-states";
export { handleChatCompletion } from "./handle-chat-completion";
export { getLastUsed } from "./last-used-state";
export { shutdown, start } from "./lifecycle";
export { getProviders } from "./providers-state";
export { routingMemory } from "./routing-memory";
export { getSessionSnapshot, onSessionPatch } from "./session-aggregator";
export type { ChatCompletionResult } from "./types";
