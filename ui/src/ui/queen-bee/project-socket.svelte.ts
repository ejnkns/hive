let boardVersion = $state(0);
let draftUpdate = $state<{
  projectId: string;
  cardId?: string;
  ideaId?: string;
  content: string;
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
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        data?: Record<string, unknown>;
      };
      if (message.type === "board_updated") {
        const data = message.data;
        if (data && data.projectId === projectId) {
          boardVersion++;
        }
      } else if (message.type === "requirements_draft_updated") {
        const data = message.data;
        if (
          data &&
          data.projectId === projectId &&
          typeof data.content === "string"
        ) {
          draftUpdate = {
            projectId,
            cardId: typeof data.cardId === "string" ? data.cardId : undefined,
            ideaId: typeof data.ideaId === "string" ? data.ideaId : undefined,
            content: data.content,
          };
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
};
