export function cardSessionKey(projectId: string, cardId: string): string {
  return `${projectId}:card:${cardId}`;
}

export function ideaSessionKey(projectId: string, ideaId: string): string {
  return `${projectId}:idea:${ideaId}`;
}
