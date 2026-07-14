/** @public — telemetry module API. Import from here, not from telemetry/ directly. */
export { applySlidingWindow } from "./telemetry/apply-sliding-window";
export { loadCache, saveCache } from "./telemetry/cache";
export type {
  Node,
  NodeScoreResult,
  RoutingStrategy,
  SubScores,
} from "./telemetry/calculate-node-score";
export { calculateNodeScore } from "./telemetry/calculate-node-score";
export type { ConversationData } from "./telemetry/conversation-store";
export { conversationStore } from "./telemetry/conversation-store";
export { telemetryRecorder } from "./telemetry/recorder";
export { classifyError } from "./telemetry/recorder/classify-error";
export {
  createStreamCounter,
  type StreamPhaseEvent,
} from "./telemetry/recorder/create-stream-counter";
export { detectRefusal } from "./telemetry/recorder/detect-refusal";
export type {
  ErrorType,
  FinishReason,
  MetricSource,
  RequestMetric,
} from "./telemetry/request-metric";
export { startHeartbeat } from "./telemetry/start-heartbeat";
export type { TelemetrySink } from "./telemetry/telemetry-sink";
export { createTelemetrySink } from "./telemetry/telemetry-sink";
