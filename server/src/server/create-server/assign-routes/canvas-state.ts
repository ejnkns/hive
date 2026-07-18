type CanvasState = {
  html: string | null;
  chatHistory: Array<{ role: string; content: string }>;
};

const store = new Map<string, CanvasState>();

export function getCanvasState(sessionId: string): CanvasState | undefined {
  return store.get(sessionId);
}

export function setCanvasState(sessionId: string, state: CanvasState): void {
  store.set(sessionId, state);
}

export function clearCanvasState(sessionId: string): void {
  store.delete(sessionId);
}
