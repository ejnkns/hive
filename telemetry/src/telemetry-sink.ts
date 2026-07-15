import type { ConversationData } from "./conversation-store";
import { conversationStore } from "./conversation-store";
import { telemetryRecorder } from "./recorder";
import type { RequestMetric } from "./request-metric";

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
