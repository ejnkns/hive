import type { Board } from "shared/board-types";
import type { QueenBeeEvent } from "shared/queen-bee-events";

let boardVersion = $state(0);
let draftUpdate = $state<{
  projectId: string;
  cardId?: string;
  ideaId?: string;
  content: string;
} | null>(null);
let boardSnapshot = $state<Board | null>(null);

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1_000;
let currentProjectId = "";

function scheduleReconnect() {
  if (!currentProjectId) return;
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  reconnectTimer = setTimeout(() => {
    connect(currentProjectId);
  }, reconnectDelay);
}

function connect(projectId: string) {
  closeSocket();
  currentProjectId = projectId;
  reconnectDelay = 1_000;

  const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
  socket = new WebSocket(
    `${protocol}//${window.location.host}/api/queen-bee/ws`
  );
  socket.onmessage = (event) => {
    try {
      // The WS payload is the QueenBeeEvent discriminated union; the switch
      // narrows message to the correct variant with full type information.
      const message = JSON.parse(String(event.data)) as QueenBeeEvent;

      switch (message.type) {
        case "board_snapshot":
          if (message.board.projectId === projectId) {
            boardVersion++;
            boardSnapshot = message.board;
          }
          break;
        case "card_moved":
        case "card_worker_progress":
        case "card_review_complete":
        case "card_accepted":
        case "card_changes_requested":
        case "card_unfulfillable":
        case "cards_created":
        case "ideas_changed":
        case "planning_outcome":
        case "integration_changed":
        case "projects_changed":
          boardVersion++;
          break;

        case "draft_updated":
        case "draft_finalized":
          draftUpdate = {
            projectId,
            cardId: message.scope === "card" ? message.scopeId : undefined,
            ideaId: message.scope === "idea" ? message.scopeId : undefined,
            content: message.content,
          };
          break;
      }
    } catch {
      // Ignore malformed events.
    }
  };
  socket.onclose = () => {
    socket = null;
    scheduleReconnect();
  };
}

function closeSocket() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
}

function disconnect() {
  closeSocket();
  currentProjectId = "";
}

export function connectProjectSocket(projectId: string) {
  if (projectId !== currentProjectId) connect(projectId);
}

export function disconnectProjectSocket() {
  disconnect();
}

export const projectSocket = {
  get boardVersion(): number {
    return boardVersion;
  },
  get draftUpdate(): {
    projectId: string;
    cardId?: string;
    ideaId?: string;
    content: string;
  } | null {
    return draftUpdate;
  },
  get boardSnapshot(): Board | null {
    return boardSnapshot;
  },
};
