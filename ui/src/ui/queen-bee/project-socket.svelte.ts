import type { QueenBeeEvent } from "shared/queen-bee-events";

let boardVersion = $state(0);
let draftUpdate = $state<{
  projectId: string;
  cardId?: string;
  ideaId?: string;
  content: string;
} | null>(null);
let boardSnapshot = $state<{
  projectId: string;
  ideas: unknown[];
  cards: unknown[];
} | null>(null);

let socket: WebSocket | null = null;
let currentProjectId = "";

function connect(projectId: string) {
  if (socket) socket.close();
  currentProjectId = projectId;

  const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
  socket = new WebSocket(
    `${protocol}//${window.location.host}/api/queen-bee/ws`
  );
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as QueenBeeEvent;

      switch (message.type) {
        case "board_snapshot":
          if (message.board.projectId === projectId) {
            boardVersion++;
            boardSnapshot = message.board as unknown as {
              projectId: string;
              ideas: unknown[];
              cards: unknown[];
            };
          }
          break;

        case "card_moved":
        case "card_worker_progress":
        case "card_review_complete":
        case "card_accepted":
        case "card_changes_requested":
        case "card_unfulfillable":
        case "cards_created":
        case "planning_outcome":
        case "integration_changed":
        case "projects_changed":
          boardVersion++;
          break;

        case "ideas_changed":
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

        default: {
          const oldMsg = message as unknown as {
            type?: string;
            data?: Record<string, unknown>;
          };
          if (
            oldMsg.type === "board_updated" &&
            oldMsg.data?.projectId === projectId
          ) {
            boardVersion++;
            if (oldMsg.data.board) {
              boardSnapshot = oldMsg.data.board as {
                projectId: string;
                ideas: unknown[];
                cards: unknown[];
              };
            }
          }
        }
      }
    } catch {
      // Ignore malformed events.
    }
  };
}

function disconnect() {
  socket?.close();
  socket = null;
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
  get boardSnapshot(): {
    projectId: string;
    ideas: unknown[];
    cards: unknown[];
  } | null {
    return boardSnapshot;
  },
};
