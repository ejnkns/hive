import type { RequestState, SessionPatch, SessionState } from "./types";

export function createSessionStore() {
  const map = new Map<string, SessionState>();
  let sessions = $state<SessionState[]>([]);

  function rebuild() {
    const all = Array.from(map.values());
    const active = all.filter((s) =>
      s.requests.some((r) => {
        const last = r.path[r.path.length - 1];
        return last !== "complete" && last !== "failed";
      })
    );
    const completed = all.filter(
      (s) =>
        !s.requests.some((r) => {
          const last = r.path[r.path.length - 1];
          return last !== "complete" && last !== "failed";
        })
    );
    active.sort((a, b) => b.lastActivity - a.lastActivity);
    completed.sort((a, b) => b.lastActivity - a.lastActivity);
    sessions = [...active, ...completed];
  }

  function getOrCreateSession(patch: SessionPatch): SessionState | null {
    let session = map.get(patch.sessionId);
    if (!session) {
      if (!patch.initial) return null;
      session = {
        sessionId: patch.sessionId,
        fingerprint: patch.initial.fingerprint,
        lastActivity: patch.initial.timestamp,
        requests: [],
      };
      map.set(patch.sessionId, session);
    }
    if (patch.lastActivity) {
      session.lastActivity = patch.lastActivity;
    }
    return session;
  }

  function getOrCreateRequest(
    session: SessionState,
    patch: SessionPatch
  ): RequestState | null {
    if (!patch.requestId) return null;
    let request = session.requests.find((r) => r.requestId === patch.requestId);
    if (!request) {
      if (!patch.requestInitial) return null;
      request = {
        requestId: patch.requestId,
        path: [],
        timestamp: patch.requestInitial.timestamp,
        prompt: patch.requestInitial.prompt,
        failovers: [],
      };
      session.requests.push(request);
    }
    return request;
  }

  function applyPatch(patch: SessionPatch) {
    const session = getOrCreateSession(patch);
    if (!session) return;

    const request = getOrCreateRequest(session, patch);
    if (!request) {
      rebuild();
      return;
    }

    if (patch.path) {
      request.path = patch.path;
    }
    if (patch.provider !== undefined) {
      request.provider = patch.provider;
    }
    if (patch.model !== undefined) {
      request.model = patch.model;
    }
    if (patch.candidates) {
      request.candidates = patch.candidates;
    }
    if (patch.selected !== undefined) {
      request.selected = patch.selected;
    }
    if (patch.strategy !== undefined) {
      request.strategy = patch.strategy;
    }
    if (patch.poolSize !== undefined) {
      request.poolSize = patch.poolSize;
    }
    if (patch.outputChars !== undefined) {
      request.outputChars = patch.outputChars;
    }
    if (patch.thinkingChars !== undefined) {
      request.thinkingChars = patch.thinkingChars;
    }
    if (patch.tokensPerSecond !== undefined) {
      request.tokensPerSecond = patch.tokensPerSecond;
    }
    if (patch.response) {
      request.response = patch.response;
    }
    if (patch.failover) {
      request.failovers = [...(request.failovers || []), patch.failover];
    }

    rebuild();
  }

  function initSessions(all: SessionState[]) {
    map.clear();
    for (const s of all) {
      map.set(s.sessionId, s);
    }
    rebuild();
  }

  return {
    get sessions() {
      return sessions;
    },
    applyPatch,
    initSessions,
  };
}
