import type { ConversationData } from "./conversation-store.ts";
import { conversationStore } from "./conversation-store.ts";
import { telemetryRecorder } from "./recorder.ts";
import type { RequestMetric } from "./request-metric.ts";

export type TelemetrySink = {
  recordMetric: (metric: RequestMetric) => void;
  completeConversation: (requestId: string, data: ConversationData) => void;
};

export function createTelemetrySink(): TelemetrySink {
  return {
    recordMetric: (metric) => telemetryRecorder.recordMetric(metric),
    completeConversation: (requestId, data) =>
      conversationStore.completeConversation(requestId, data),
  };
}
