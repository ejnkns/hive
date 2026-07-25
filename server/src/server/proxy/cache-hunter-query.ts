import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HIVE_DIR } from "shared/hive-dir";

const DB_PATH = join(HIVE_DIR, "cache-hunter.db");

export function openCacheHunterDb(): DatabaseSync {
  return new DatabaseSync(DB_PATH);
}

export function latencyPerToken(db: DatabaseSync, minTokens = 50): void {
  const rows = db
    .prepare(
      `SELECT r.provider, r.model, resp.duration_ms, resp.prompt_tokens,
              resp.completion_tokens, resp.total_tokens,
              round(resp.duration_ms * 1.0 / resp.total_tokens, 2) as ms_per_token
       FROM responses resp
       JOIN requests r ON r.id = resp.request_id
       WHERE resp.total_tokens > ?
         AND resp.status_code = 200
       ORDER BY ms_per_token DESC
       LIMIT 20`
    )
    .all(minTokens);

  console.log("=== Latency per token (high = potential cache miss) ===");
  console.table(rows);
}

export function requestOrder(db: DatabaseSync, limit = 20): void {
  const rows = db
    .prepare(
      `SELECT datetime(resp.timestamp/1000, 'unixepoch', 'localtime') as time,
              r.provider, r.model, resp.status_code, resp.duration_ms,
              resp.prompt_tokens, resp.completion_tokens, resp.finish_reason
       FROM responses resp
       JOIN requests r ON r.id = resp.request_id
       ORDER BY resp.timestamp DESC
       LIMIT ?`
    )
    .all(limit);

  console.log("=== Recent requests ===");
  console.table(rows);
}

export function prefixOverlap(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT a.id as newer_id, b.id as older_id,
              substr(a.body, 1, 120) as newer_prefix,
              substr(b.body, 1, 120) as older_prefix
       FROM requests a
       JOIN requests b ON b.timestamp < a.timestamp
       WHERE a.path LIKE '%chat/completions%'
         AND b.path LIKE '%chat/completions%'
         AND length(a.body) > 100
         AND length(b.body) > 100
         AND a.body LIKE substr(b.body, 1, 100) || '%'
       ORDER BY a.timestamp DESC
       LIMIT 10`
    )
    .all();

  console.log("=== Prefix overlap (shared context = potential cache hit) ===");
  console.table(rows);
}

export function latencyTimeline(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT datetime(resp.timestamp/1000, 'unixepoch', 'localtime') as time,
              r.provider, r.model, resp.duration_ms, resp.prompt_tokens,
              resp.completion_tokens
       FROM responses resp
       JOIN requests r ON r.id = resp.request_id
       WHERE resp.status_code = 200
       ORDER BY resp.timestamp
       LIMIT 50`
    )
    .all();

  console.log("=== Latency timeline ===");
  console.table(rows);
}
