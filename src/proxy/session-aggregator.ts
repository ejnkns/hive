import {
  type FlowEvent,
  onFlowEvent,
  type RequestState,
  type SessionPatch,
  type SessionStage,
  type SessionState,
} from "./flow-events";

type SessionPatchListener = (patch: SessionPatch) => void;

const patchListeners = new Set<SessionPatchListener>();

export function onSessionPatch(listener: SessionPatchListener): () => void {
  patchListeners.add(listener);
  return () => {
    patchListeners.delete(listener);
  };
}

const sessionMap = new Map<string, SessionState>();
const requestToSession = new Map<string, string>();
const MAX_SESSIONS = 100;

const STAGE_MAP: Record<string, SessionStage> = {
  request_received: "received",
  selection_round: "selection",
  node_dispatched: "dispatched",
  thinking_started: "thinking",
  streaming_started: "streaming",
  tool_accumulating: "tool_use",
};

const STAGE_ORDER: Record<string, number> = {
  received: 0,
  selection: 1,
  dispatched: 2,
  thinking: 3,
  streaming: 4,
  tool_use: 5,
  complete: 6,
  failed: 6,
};

function getOrCreateRequest(
  session: SessionState,
  requestId: string,
  timestamp: number,
  prompt?: string
): RequestState {
  let request = session.requests.find((r) => r.requestId === requestId);
  if (!request) {
    request = {
      requestId,
      path: [],
      timestamp,
      prompt,
      failovers: [],
    };
    session.requests.push(request);
  }
  return request;
}

function maybeAdvanceStage(
  request: RequestState,
  newStage: SessionStage
): boolean {
  const lastStage = request.path.at(-1);
  const current = lastStage ? (STAGE_ORDER[lastStage] ?? -1) : -1;
  const incoming = STAGE_ORDER[newStage] ?? -1;
  if (incoming > current) {
    request.path.push(newStage);
    return true;
  }
  return false;
}

function evictIfNeeded() {
  while (sessionMap.size > MAX_SESSIONS) {
    let oldestEvictable: string | null = null;
    let oldestActivity = Infinity;
    for (const [id, s] of sessionMap) {
      const hasActive = s.requests.some((r) => {
        const last = r.path.at(-1);
        return last !== "complete" && last !== "failed";
      });
      if (!hasActive && s.lastActivity < oldestActivity) {
        oldestActivity = s.lastActivity;
        oldestEvictable = id;
      }
    }
    if (oldestEvictable) {
      const session = sessionMap.get(oldestEvictable);
      if (session) {
        for (const req of session.requests) {
          requestToSession.delete(req.requestId);
        }
      }
      sessionMap.delete(oldestEvictable);
    } else {
      break;
    }
  }
}

function emitPatch(patch: SessionPatch) {
  if (patchListeners.size === 0) return;
  for (const listener of patchListeners) {
    try {
      listener(patch);
    } catch {
      // ignore listener errors
    }
  }
}

export function getSessionSnapshot(): SessionState[] {
  return Array.from(sessionMap.values());
}

onFlowEvent((event: FlowEvent) => {
  const sessionId =
    event.type === "request_received"
      ? event.sessionId
      : (requestToSession.get(event.requestId) ?? "");
  let session = sessionMap.get(sessionId);

  if (event.type === "request_received") {
    if (!session) {
      session = {
        sessionId,
        lastActivity: event.timestamp,
        requests: [],
      };
      sessionMap.set(sessionId, session);
      const patch: SessionPatch = {
        sessionId,
        initial: { timestamp: event.timestamp },
        lastActivity: event.timestamp,
      };
      emitPatch(patch);
    } else {
      session.lastActivity = event.timestamp;
    }

    requestToSession.set(event.requestId, sessionId);

    const request = getOrCreateRequest(
      session,
      event.requestId,
      event.timestamp,
      event.promptPreview
    );
    request.path.push("received");
    if (event.toolLoopDetected) {
      request.toolLoopDetected = true;
    }

    const patch: SessionPatch = {
      sessionId,
      lastActivity: event.timestamp,
      requestId: event.requestId,
      requestInitial: {
        timestamp: event.timestamp,
        prompt: event.promptPreview,
      },
      path: [...request.path],
      toolLoopDetected: event.toolLoopDetected,
    };
    emitPatch(patch);

    evictIfNeeded();
    return;
  }

  if (!session) return;

  session.lastActivity = Date.now();
  const request = getOrCreateRequest(
    session,
    event.requestId,
    session.lastActivity
  );
  const patch: SessionPatch = {
    sessionId,
    lastActivity: session.lastActivity,
    requestId: event.requestId,
  };

  const stage = STAGE_MAP[event.type] as SessionStage | undefined;
  if (stage && maybeAdvanceStage(request, stage)) {
    patch.path = [...request.path];
  }

  if (event.type === "selection_round") {
    request.candidates = event.candidates;
    request.selected = event.selected ?? undefined;
    request.strategy = event.strategy;
    request.poolSize = event.poolSize;
    patch.candidates = event.candidates;
    patch.selected = event.selected ?? undefined;
    patch.strategy = event.strategy;
    patch.poolSize = event.poolSize;
  }

  if (
    event.type === "node_dispatched" ||
    event.type === "thinking_started" ||
    event.type === "streaming_started"
  ) {
    request.provider = event.provider;
    request.model = event.model;
    patch.provider = event.provider;
    patch.model = event.model;
  }

  if (event.type === "token_tick") {
    request.outputChars = event.outputChars;
    request.thinkingChars = event.thinkingChars;
    request.tokensPerSecond = event.tokensPerSecond;
    request.provider = event.provider;
    request.model = event.model;
    patch.outputChars = event.outputChars;
    patch.thinkingChars = event.thinkingChars;
    patch.tokensPerSecond = event.tokensPerSecond;
    patch.provider = event.provider;
    patch.model = event.model;
  }

  if (event.type === "tool_accumulating") {
    request.provider = event.provider;
    request.model = event.model;
    patch.provider = event.provider;
    patch.model = event.model;
  }

  if (event.type === "response_complete") {
    request.response = {
      provider: event.provider,
      model: event.model,
      statusCode: event.statusCode,
      success: event.success,
      ttft: event.ttft,
      totalLatency: event.totalLatency,
      outputTokens: event.outputTokens,
      finishReason: event.finishReason,
      toolCallFailed: event.toolCallFailed,
      errorType: event.errorType,
    };
    request.provider = event.provider;
    request.model = event.model;
    const finalStage: SessionStage = event.success ? "complete" : "failed";
    if (maybeAdvanceStage(request, finalStage)) {
      patch.path = [...request.path];
    }
    patch.provider = event.provider;
    patch.model = event.model;
    patch.response = request.response;
  }

  if (event.type === "failover_attempt") {
    const failover = {
      provider: event.failedProvider,
      model: event.failedModel,
      errorType: event.errorType,
    };
    request.failovers.push(failover);
    patch.failover = failover;
  }

  if (event.type === "circuit_break") {
    request.provider = event.provider;
    request.model = event.model;
    patch.provider = event.provider;
    patch.model = event.model;
  }

  emitPatch(patch);
});
