import { LRUCache } from "lru-cache";

const SESSION_MAX = 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;

export class SessionRegistry {
  private cache = new LRUCache<string, string>({
    max: SESSION_MAX,
    ttl: SESSION_TTL_MS,
  });

  get(sessionId: string): string | undefined {
    return this.cache.get(sessionId);
  }

  set(sessionId: string, nodeKey: string): void {
    this.cache.set(sessionId, nodeKey);
  }

  clear(): void {
    this.cache.clear();
  }
}
