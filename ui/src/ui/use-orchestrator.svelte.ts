import type { OrchestrationEvent } from "shared/orchestration-event";

export type OrchestratorMessage = {
  role: string;
  content: string;
  streaming?: boolean;
  toolCalls?: {
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }[];
  toolCallId?: string;
};

export type OrchestratorSession = {
  sessionId: string;
  label: string;
  prompt: string;
  messages: OrchestratorMessage[];
  iteration: number;
  status: "idle" | "running" | "complete" | "error";
  finishReason: string | null;
  error: string | null;
  startedAt: number;
};

export function createOrchestratorStore() {
  let session = $state<OrchestratorSession | null>(null);

  function start(prompt: string) {
    const sessionId = `orch-${Date.now().toString(36)}`;
    const label = prompt.length > 30 ? `${prompt.slice(0, 30)}...` : prompt;
    session = {
      sessionId,
      label,
      prompt,
      messages: [],
      iteration: 0,
      status: "running",
      finishReason: null,
      error: null,
      startedAt: Date.now(),
    };
    return sessionId;
  }

  function applyEvent(event: OrchestrationEvent & { sessionId?: string }) {
    if (!session) return;

    if (event.type === "iteration_start") {
      session.iteration = event.iteration;
    } else if (event.type === "streaming_started") {
      session.messages.push({
        role: "assistant",
        content: "",
        streaming: true,
      });
    } else if (event.type === "content_delta") {
      const lastMsg = session.messages.at(-1);
      if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
        lastMsg.content = event.content;
      }
    } else if (event.type === "model_complete") {
      const lastMsg = session.messages.at(-1);
      if (lastMsg && lastMsg.role === "assistant" && lastMsg.streaming) {
        lastMsg.streaming = false;
      }
    } else if (event.type === "tool_executed") {
      // tool result will come via applyComplete
    } else if (event.type === "complete") {
      session.status = "complete";
      session.finishReason = event.finishReason;
    } else if (event.type === "error") {
      session.status = "error";
      session.error = event.error;
    }
  }

  function applyComplete(data: {
    messages: OrchestratorMessage[];
    finish_reason: string;
    iterations: number;
    error?: string;
  }) {
    if (!session) return;
    session.messages = data.messages;
    session.iteration = data.iterations;
    session.finishReason = data.finish_reason;
    if (data.finish_reason === "error") {
      session.status = "error";
      session.error = data.error ?? "Unknown error";
    } else {
      session.status = "complete";
    }
  }

  function reset() {
    session = null;
  }

  return {
    get session() {
      return session;
    },
    start,
    applyEvent,
    applyComplete,
    reset,
  };
}
