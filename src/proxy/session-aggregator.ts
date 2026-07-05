import {
  type FlowEvent,
  onFlowEvent,
  type SessionPatch,
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
const MAX_SESSIONS = 100;

const STAGE_MAP: Record<string, SessionState["stage"]> = {
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

function getSession(requestId: string): SessionState {
  let session = sessionMap.get(requestId);
  if (!session) {
    session = {
      requestId,
      stage: "received",
      timestamp: Date.now(),
      failovers: [],
    };
    sessionMap.set(requestId, session);
  }
  return session;
}

function maybeAdvanceStage(
  session: SessionState,
  newStage: SessionStage
): boolean {
  const current = STAGE_ORDER[session.stage] ?? -1;
  const incoming = STAGE_ORDER[newStage] ?? -1;
  if (incoming > current) {
    session.stage = newStage;
    return true;
  }
  return false;
}

function evictIfNeeded() {
  while (sessionMap.size > MAX_SESSIONS) {
    let oldestCompleted: string | null = null;
    let oldestTimestamp = Infinity;
    for (const [id, s] of sessionMap) {
      if (
        (s.stage === "complete" || s.stage === "failed") &&
        s.timestamp < oldestTimestamp
      ) {
        oldestTimestamp = s.timestamp;
        oldestCompleted = id;
      }
    }
    if (oldestCompleted) {
      sessionMap.delete(oldestCompleted);
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
  const session = getSession(event.requestId);
  const patch: SessionPatch = { requestId: event.requestId };

  if (event.type === "request_received") {
    patch.initial = { timestamp: event.timestamp, prompt: event.promptPreview };
    session.timestamp = event.timestamp;
    session.prompt = event.promptPreview;
  }

  const stage = STAGE_MAP[event.type] as SessionStage | undefined;
  if (stage && maybeAdvanceStage(session, stage)) {
    patch.stage = stage;
  }

  if (event.type === "selection_round") {
    session.candidates = event.candidates;
    session.selected = event.selected ?? undefined;
    session.strategy = event.strategy;
    session.poolSize = event.poolSize;
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
    session.provider = event.provider;
    session.model = event.model;
    patch.provider = event.provider;
    patch.model = event.model;
  }

  if (event.type === "token_tick") {
    session.outputChars = event.outputChars;
    session.thinkingChars = event.thinkingChars;
    session.tokensPerSecond = event.tokensPerSecond;
    session.provider = event.provider;
    session.model = event.model;
    patch.outputChars = event.outputChars;
    patch.thinkingChars = event.thinkingChars;
    patch.tokensPerSecond = event.tokensPerSecond;
    patch.provider = event.provider;
    patch.model = event.model;
  }

  if (event.type === "tool_accumulating") {
    session.provider = event.provider;
    session.model = event.model;
    patch.provider = event.provider;
    patch.model = event.model;
  }

  if (event.type === "response_complete") {
    session.response = {
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
    session.provider = event.provider;
    session.model = event.model;
    const finalStage: SessionStage = event.success ? "complete" : "failed";
    if (maybeAdvanceStage(session, finalStage)) {
      patch.stage = finalStage;
    }
    patch.provider = event.provider;
    patch.model = event.model;
    patch.response = session.response;
  }

  if (event.type === "failover_attempt") {
    const failover = {
      provider: event.failedProvider,
      model: event.failedModel,
      errorType: event.errorType,
    };
    session.failovers.push(failover);
    patch.failover = failover;
  }

  if (event.type === "circuit_break") {
    session.provider = event.provider;
    session.model = event.model;
    patch.provider = event.provider;
    patch.model = event.model;
  }

  if (sessionMap.size > MAX_SESSIONS) {
    evictIfNeeded();
  }

  emitPatch(patch);
});
