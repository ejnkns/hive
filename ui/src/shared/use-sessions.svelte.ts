import type { SessionSnapshot, SessionState } from "shared/dashboard-types";

// The server pushes complete session snapshots (init + session_snapshot); this
// store just holds the latest one for the dashboard. No patch logic — the
// consumer replaces wholesale (`sessions = msg.sessions`).
export function createSessionStore() {
  let sessions = $state<SessionState[]>([]);

  function replaceAll(snapshot: SessionSnapshot) {
    sessions = [...snapshot.active, ...snapshot.completed];
  }

  return {
    get sessions() {
      return sessions;
    },
    replaceAll,
  };
}
