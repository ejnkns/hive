import type {
  CandidateInfo,
  PipelineStateMessage,
  RequestState,
  SessionSnapshot,
  SessionStage,
  SessionState,
} from "shared/dashboard-types";
import { isTerminal } from "shared/dashboard-types";
import { conversationStore } from "telemetry/conversation-store";

type AggregatorCallbacks = {
  onSnapshot: (snapshot: SessionSnapshot) => void;
  onPipelineState: (event: PipelineStateMessage) => void;
};

let callbacks: AggregatorCallbacks | null = null;

export function setAggregatorCallbacks(cbs: AggregatorCallbacks) {
  callbacks = cbs;
}

const sessionMap = new Map<string, SessionState>();
const requestToSession = new Map<string, string>();
const chainHeads = new Map<string, string>();
const chainCounts = new Map<string, number>();
const MAX_SESSIONS = 100;

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

function buildSessionSnapshot(): SessionSnapshot {
  const all = Array.from(sessionMap.values());
  const active = all.filter((s) =>
    s.requests.some((r) => {
      const last = r.path[r.path.length - 1];
      return last === undefined || !isTerminal(last);
    })
  );
  const completed = all.filter(
    (s) =>
      !s.requests.some((r) => {
        const last = r.path[r.path.length - 1];
        return last === undefined || !isTerminal(last);
      })
  );
  active.sort((a, b) => b.lastActivity - a.lastActivity);
  completed.sort((a, b) => b.lastActivity - a.lastActivity);
  return { active, completed };
}

function emitSnapshot() {
  if (!callbacks) return;
  callbacks.onSnapshot(buildSessionSnapshot());
}

function emitPipelineState(event: PipelineStateMessage) {
  if (!callbacks) return;
  callbacks.onPipelineState(event);
}

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
        return last === undefined || !isTerminal(last);
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
          chainHeads.delete(req.requestId);
          chainCounts.delete(req.requestId);
        }
      }
      sessionMap.delete(oldestEvictable);
    } else {
      break;
    }
  }
}

function effectiveRequestId(requestId: string): string {
  return chainHeads.get(requestId) ?? requestId;
}

export function getSessionSnapshot(): SessionSnapshot {
  const conversations = conversationStore.getConversations();
  const convByRequestId = new Map<string, (typeof conversations)[number]>();
  for (const c of conversations) {
    convByRequestId.set(c.requestId, c);
  }

  const all = Array.from(sessionMap.values()).map((session) => ({
    ...session,
    requests: session.requests.map((req) => {
      const conv = convByRequestId.get(req.requestId);
      if (!conv) return req;
      return {
        ...req,
        conversationPrompt: conv.prompt,
        responseText: conv.responseText,
      };
    }),
  }));

  const active = all.filter((s) =>
    s.requests.some((r) => {
      const last = r.path[r.path.length - 1];
      return last === undefined || !isTerminal(last);
    })
  );
  const completed = all.filter(
    (s) =>
      !s.requests.some((r) => {
        const last = r.path[r.path.length - 1];
        return last === undefined || !isTerminal(last);
      })
  );
  active.sort((a, b) => b.lastActivity - a.lastActivity);
  completed.sort((a, b) => b.lastActivity - a.lastActivity);
  return { active, completed };
}

function resolveSessionId(event: {
  requestId: string;
  sessionId?: string;
}): string {
  if (event.sessionId) return event.sessionId;
  return requestToSession.get(event.requestId) ?? "";
}

// ---------------------------------------------------------------------------
// Public record methods — called directly from the proxy pipeline
// ---------------------------------------------------------------------------

export function recordRequestReceived(event: {
  requestId: string;
  sessionId: string;
  timestamp: number;
  promptPreview: string;
  toolLoopDetected?: boolean;
}) {
  let session = sessionMap.get(event.sessionId);
  if (!session) {
    session = {
      sessionId: event.sessionId,
      lastActivity: event.timestamp,
      requests: [],
    };
    sessionMap.set(event.sessionId, session);
  } else {
    session.lastActivity = event.timestamp;
  }

  requestToSession.set(event.requestId, event.sessionId);

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

  emitPipelineState({
    type: "pipeline_state",
    requestId: event.requestId,
    sessionId: event.sessionId,
    stage: "received",
    provider: null,
    model: null,
    timestamp: event.timestamp,
  });

  emitSnapshot();
  evictIfNeeded();
}

export function recordSelectionRound(event: {
  requestId: string;
  strategy: string;
  candidates: CandidateInfo[];
  selected: string | null;
  poolSize: number;
}) {
  const sessionId = resolveSessionId(event);
  const session = sessionMap.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  const effectiveId = effectiveRequestId(event.requestId);
  const request = getOrCreateRequest(
    session,
    effectiveId,
    session.lastActivity
  );

  request.candidates = event.candidates;
  request.selected = event.selected ?? undefined;
  request.strategy = event.strategy;
  request.poolSize = event.poolSize;

  if (maybeAdvanceStage(request, "selection")) {
    emitPipelineState({
      type: "pipeline_state",
      requestId: effectiveId,
      sessionId,
      stage: "selection",
      provider: null,
      model: null,
      timestamp: session.lastActivity,
    });
  }

  emitSnapshot();
}

export function recordNodeDispatched(event: {
  requestId: string;
  provider: string;
  model: string;
  attempt: number;
}) {
  const sessionId = resolveSessionId(event);
  const session = sessionMap.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  const effectiveId = effectiveRequestId(event.requestId);
  const request = getOrCreateRequest(
    session,
    effectiveId,
    session.lastActivity
  );

  request.provider = event.provider;
  request.model = event.model;

  if (maybeAdvanceStage(request, "dispatched")) {
    emitPipelineState({
      type: "pipeline_state",
      requestId: effectiveId,
      sessionId,
      stage: "dispatched",
      provider: event.provider,
      model: event.model,
      timestamp: session.lastActivity,
    });
  }

  emitSnapshot();
}

export function recordThinkingStarted(event: {
  requestId: string;
  provider: string;
  model: string;
}) {
  const sessionId = resolveSessionId(event);
  const session = sessionMap.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  const effectiveId = effectiveRequestId(event.requestId);
  const request = getOrCreateRequest(
    session,
    effectiveId,
    session.lastActivity
  );

  request.provider = event.provider;
  request.model = event.model;

  if (maybeAdvanceStage(request, "thinking")) {
    emitPipelineState({
      type: "pipeline_state",
      requestId: effectiveId,
      sessionId,
      stage: "thinking",
      provider: event.provider,
      model: event.model,
      timestamp: session.lastActivity,
    });
  }

  emitSnapshot();
}

export function recordStreamingStarted(event: {
  requestId: string;
  provider: string;
  model: string;
}) {
  const sessionId = resolveSessionId(event);
  const session = sessionMap.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  const effectiveId = effectiveRequestId(event.requestId);
  const request = getOrCreateRequest(
    session,
    effectiveId,
    session.lastActivity
  );

  request.provider = event.provider;
  request.model = event.model;

  if (maybeAdvanceStage(request, "streaming")) {
    emitPipelineState({
      type: "pipeline_state",
      requestId: effectiveId,
      sessionId,
      stage: "streaming",
      provider: event.provider,
      model: event.model,
      timestamp: session.lastActivity,
    });
  }

  emitSnapshot();
}

export function recordTokenTick(event: {
  requestId: string;
  provider: string;
  model: string;
  outputChars: number;
  thinkingChars: number;
  tokensPerSecond: number;
}) {
  const sessionId = resolveSessionId(event);
  const session = sessionMap.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  const effectiveId = effectiveRequestId(event.requestId);
  const request = getOrCreateRequest(
    session,
    effectiveId,
    session.lastActivity
  );

  request.outputChars = event.outputChars;
  request.thinkingChars = event.thinkingChars;
  request.tokensPerSecond = event.tokensPerSecond;
  request.provider = event.provider;
  request.model = event.model;

  emitSnapshot();
}

export function recordToolAccumulating(event: {
  requestId: string;
  provider: string;
  model: string;
  toolIndex: number;
}) {
  const sessionId = resolveSessionId(event);
  const session = sessionMap.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  const effectiveId = effectiveRequestId(event.requestId);
  const request = getOrCreateRequest(
    session,
    effectiveId,
    session.lastActivity
  );

  request.provider = event.provider;
  request.model = event.model;

  if (maybeAdvanceStage(request, "tool_use")) {
    emitPipelineState({
      type: "pipeline_state",
      requestId: effectiveId,
      sessionId,
      stage: "tool_use",
      provider: event.provider,
      model: event.model,
      timestamp: session.lastActivity,
    });
  }

  emitSnapshot();
}

export function recordResponseComplete(event: {
  requestId: string;
  provider: string;
  model: string;
  statusCode: number;
  success: boolean;
  ttft: number;
  totalLatency: number;
  outputTokens: number | null;
  finishReason: string | null;
  toolCallFailed: boolean;
  errorType: string | null;
}) {
  const sessionId = resolveSessionId(event);
  const session = sessionMap.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  const effectiveId = effectiveRequestId(event.requestId);
  const request = getOrCreateRequest(
    session,
    effectiveId,
    session.lastActivity
  );

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
    emitPipelineState({
      type: "pipeline_state",
      requestId: effectiveId,
      sessionId,
      stage: finalStage,
      provider: event.provider,
      model: event.model,
      timestamp: session.lastActivity,
    });
  }

  const conversations = conversationStore.getConversations();
  const conv = conversations.find((c) => c.requestId === event.requestId);
  if (conv) {
    request.conversationPrompt = conv.prompt;
    request.responseText = conv.responseText;
  }

  emitSnapshot();
}

export function recordFailoverAttempt(event: {
  requestId: string;
  failedProvider: string;
  failedModel: string;
  errorType: string;
  attempt: number;
}) {
  const sessionId = resolveSessionId(event);
  const session = sessionMap.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  const failoverRequest = getOrCreateRequest(
    session,
    event.requestId,
    session.lastActivity
  );
  const failover = {
    provider: event.failedProvider,
    model: event.failedModel,
    errorType: event.errorType,
  };
  failoverRequest.failovers.push(failover);

  if (
    failoverRequest.path.at(-1) !== "failed" &&
    failoverRequest.path.at(-1) !== "complete"
  ) {
    failoverRequest.path.push("failed");
  }

  emitPipelineState({
    type: "pipeline_state",
    requestId: event.requestId,
    sessionId,
    stage: "failed",
    provider: event.failedProvider,
    model: event.failedModel,
    timestamp: session.lastActivity,
  });

  let count = chainCounts.get(event.requestId) ?? 0;
  count++;
  chainCounts.set(event.requestId, count);

  const nextId = `${event.requestId}/F${count}`;
  chainHeads.set(event.requestId, nextId);
  requestToSession.set(nextId, sessionId);

  const parentRequest = session.requests.find(
    (r) => r.requestId === event.requestId
  );
  const nextRequest: RequestState = {
    requestId: nextId,
    path: [],
    timestamp: Date.now(),
    failovers: [],
    prompt: parentRequest?.prompt,
  };
  session.requests.push(nextRequest);

  emitSnapshot();
}

export function recordCircuitBreak(event: {
  requestId: string;
  provider: string;
  model: string;
  cooldownDurationSec: number;
}) {
  const sessionId = resolveSessionId(event);
  const session = sessionMap.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  const effectiveId = effectiveRequestId(event.requestId);
  const request = getOrCreateRequest(
    session,
    effectiveId,
    session.lastActivity
  );

  request.provider = event.provider;
  request.model = event.model;

  emitSnapshot();
}

export function recordOverrideFailed(event: {
  requestId: string;
  provider: string;
  model: string;
  statusCode: number;
  errorType: string;
  errorBody: string;
}) {
  const sessionId = resolveSessionId(event);
  const session = sessionMap.get(sessionId);
  if (!session) return;

  session.lastActivity = Date.now();

  const effectiveId = effectiveRequestId(event.requestId);
  const request = getOrCreateRequest(
    session,
    effectiveId,
    session.lastActivity
  );

  request.overrideError = {
    provider: event.provider,
    model: event.model,
    statusCode: event.statusCode,
    errorType: event.errorType,
    errorBody: event.errorBody,
  };
  request.provider = event.provider;
  request.model = event.model;

  emitSnapshot();
}
