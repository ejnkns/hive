import type { FinishReason } from "./request-metric";

type ContentPart = {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
};

type Conversation = {
  requestId: string;
  provider: string;
  model: string;
  timestamp: number;
  ttft: number | null;
  totalLatency: number | null;
  statusCode: number;
  success: boolean;
  prompt: { role: string; content: string | ContentPart[] }[];
  responseText: string;
  outputTokens: number | null;
  finishReason: FinishReason;
  refused: boolean;
};

function createConversationStore() {
  const buffer: Conversation[] = [];
  const pending: Map<
    string,
    {
      prompt: { role: string; content: string | ContentPart[] }[];
      timestamp: number;
    }
  > = new Map();
  const maxEntries = 20;

  function startConversation(
    requestId: string,
    prompt: { role: string; content: string | ContentPart[] }[]
  ): void {
    pending.set(requestId, {
      prompt,
      timestamp: Date.now(),
    });
  }

  function completeConversation(
    requestId: string,
    data: {
      provider: string;
      model: string;
      ttft: number | null;
      totalLatency: number | null;
      statusCode: number;
      success: boolean;
      responseText: string;
      outputTokens: number | null;
      finishReason: FinishReason;
      refused: boolean;
    }
  ): void {
    const entry = pending.get(requestId);
    if (!entry) return;

    buffer.unshift({
      requestId,
      ...data,
      prompt: entry.prompt,
      timestamp: entry.timestamp,
    });

    if (buffer.length > maxEntries) {
      buffer.pop();
    }

    pending.delete(requestId);
  }

  function getConversations(): Conversation[] {
    return buffer;
  }

  return { startConversation, completeConversation, getConversations };
}

export const conversationStore = createConversationStore();
