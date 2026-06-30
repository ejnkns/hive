type ContentPart = { type: string; text?: string; image_url?: { url: string } };

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
  finishReason: string | null;
  refused: boolean;
};

class ConversationStore {
  private buffer: Conversation[] = [];
  private pending: Map<
    string,
    {
      prompt: { role: string; content: string | ContentPart[] }[];
      timestamp: number;
    }
  > = new Map();
  private readonly maxEntries = 20;

  startConversation(requestId: string, prompt: { role: string; content: string | ContentPart[] }[]): void {
    this.pending.set(requestId, {
      prompt,
      timestamp: Date.now(),
    });
  }

  completeConversation(
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
      finishReason: string | null;
      refused: boolean;
    }
  ): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;

    this.buffer.unshift({
      requestId,
      ...data,
      prompt: pending.prompt,
      timestamp: pending.timestamp,
    });

    if (this.buffer.length > this.maxEntries) {
      this.buffer.pop();
    }

    this.pending.delete(requestId);
  }

  getConversations(): Conversation[] {
    return this.buffer;
  }
}

export const conversationStore = new ConversationStore();
