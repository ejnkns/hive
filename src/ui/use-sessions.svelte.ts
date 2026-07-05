import type { SessionPatch, SessionState } from "./types";

export function createSessionStore() {
  const map = new Map<string, SessionState>();
  let sessions = $state<SessionState[]>([]);

  function rebuild() {
    const all = Array.from(map.values());
    const active = all.filter(
      (s) => s.stage !== "complete" && s.stage !== "failed"
    );
    const completed = all.filter(
      (s) => s.stage === "complete" || s.stage === "failed"
    );
    active.sort((a, b) => b.timestamp - a.timestamp);
    completed.sort((a, b) => b.timestamp - a.timestamp);
    sessions = [...active, ...completed];
  }

  function applyPatch(patch: SessionPatch) {
    let session = map.get(patch.requestId);
    if (!session) {
      if (!patch.initial) return;
      session = {
        requestId: patch.requestId,
        stage: "received",
        timestamp: patch.initial.timestamp,
        prompt: patch.initial.prompt,
        failovers: [],
      };
      map.set(patch.requestId, session);
    }

    if (patch.stage) {
      session.stage = patch.stage;
    }
    if (patch.provider !== undefined) {
      session.provider = patch.provider;
    }
    if (patch.model !== undefined) {
      session.model = patch.model;
    }
    if (patch.candidates) {
      session.candidates = patch.candidates;
    }
    if (patch.selected !== undefined) {
      session.selected = patch.selected;
    }
    if (patch.strategy !== undefined) {
      session.strategy = patch.strategy;
    }
    if (patch.poolSize !== undefined) {
      session.poolSize = patch.poolSize;
    }
    if (patch.outputChars !== undefined) {
      session.outputChars = patch.outputChars;
    }
    if (patch.thinkingChars !== undefined) {
      session.thinkingChars = patch.thinkingChars;
    }
    if (patch.tokensPerSecond !== undefined) {
      session.tokensPerSecond = patch.tokensPerSecond;
    }
    if (patch.response) {
      session.response = patch.response;
    }
    if (patch.failover) {
      session.failovers = [...(session.failovers || []), patch.failover];
    }

    rebuild();
  }

  function initSessions(all: SessionState[]) {
    map.clear();
    for (const s of all) {
      map.set(s.requestId, s);
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
