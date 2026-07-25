import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HIVE_DIR } from "shared/hive-dir";
import { logger } from "shared/logger";

let db: DatabaseSync | null = null;
let insertRequest: ReturnType<DatabaseSync["prepare"]> | null = null;
let insertResponse: ReturnType<DatabaseSync["prepare"]> | null = null;

function extractCacheSalt(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const salt = parsed.cache_salt;
    return typeof salt === "string" ? salt : null;
  } catch {
    return null;
  }
}

function sanitizeHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const sanitized = { ...headers };
  delete sanitized.authorization;
  delete sanitized.Authorization;
  return sanitized;
}

export function logRequest(data: {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  provider: string;
  model: string;
}): void {
  if (!db) return;
  try {
    const cacheSalt = extractCacheSalt(data.body);
    insertRequest!.run(
      data.id,
      data.timestamp,
      data.method,
      data.path,
      JSON.stringify(sanitizeHeaders(data.headers)),
      data.body,
      cacheSalt,
      data.provider,
      data.model
    );
  } catch (err) {
    logger.debug(`cache-hunter: logRequest error: ${err}`);
  }
}

export function logResponse(data: {
  id: string;
  requestId: string;
  timestamp: number;
  statusCode: number;
  headers: Record<string, string | string[] | undefined> | null;
  body: string | null;
  durationMs: number;
  ttftMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  finishReason: string | null;
}): void {
  if (!db) return;
  try {
    insertResponse!.run(
      data.id,
      data.timestamp,
      data.requestId,
      data.statusCode,
      data.headers ? JSON.stringify(data.headers) : null,
      data.body,
      data.durationMs,
      data.ttftMs,
      data.promptTokens,
      data.completionTokens,
      data.totalTokens,
      data.finishReason
    );
  } catch (err) {
    logger.debug(`cache-hunter: logResponse error: ${err}`);
  }
}

export function initCacheHunterLogger(): void {
  if (db) return;

  const envPath = process.env.HIVE_CACHE_HUNT;
  if (!envPath) return;

  try {
    const resolvedPath =
      envPath === "1" ? join(HIVE_DIR, "cache-hunter.db") : envPath;

    const dir = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    db = new DatabaseSync(resolvedPath);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA synchronous=NORMAL");

    db.exec(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      headers TEXT,
      body TEXT NOT NULL,
      cache_salt TEXT,
      provider TEXT,
      model TEXT
    )`);

    db.exec(`CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status_code INTEGER NOT NULL,
      headers TEXT,
      body TEXT,
      duration_ms INTEGER NOT NULL,
      ttft_ms INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      finish_reason TEXT,
      FOREIGN KEY (request_id) REFERENCES requests(id)
    )`);

    insertRequest = db.prepare(`INSERT INTO requests
      (id, timestamp, method, path, headers, body, cache_salt, provider, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    insertResponse = db.prepare(`INSERT INTO responses
      (id, timestamp, request_id, status_code, headers, body, duration_ms,
       ttft_ms, prompt_tokens, completion_tokens, total_tokens, finish_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    logger.debug(`cache-hunter: logging to ${resolvedPath}`);
  } catch (err) {
    logger.debug(`cache-hunter: init error: ${err}`);
  }
}

export function closeCacheHunterLogger(): void {
  if (db) {
    db.close();
    db = null;
    insertRequest = null;
    insertResponse = null;
  }
}
