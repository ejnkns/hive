import { LRUCache } from "lru-cache";

export class SessionRegistry {
  private cache: LRUCache<string, string>;

  constructor() {
    this.cache = new LRUCache<string, string>({
      max: 1000,
      ttl: 1000 * 60 * 60,
    });
  }

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

export const sessionRegistry = new SessionRegistry();
