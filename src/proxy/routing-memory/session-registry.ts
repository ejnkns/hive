import { LRUCache } from "lru-cache";

const SESSION_MAX = 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;

export function createSessionRegistry() {
  const cache = new LRUCache<string, string>({
    max: SESSION_MAX,
    ttl: SESSION_TTL_MS,
  });

  function get(sessionId: string): string | undefined {
    return cache.get(sessionId);
  }

  function set(sessionId: string, nodeKey: string): void {
    cache.set(sessionId, nodeKey);
  }

  function clear(): void {
    cache.clear();
  }

  return { get, set, clear };
}
