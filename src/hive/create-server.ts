import Fastify from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./shared/logger";
import { hiveCore } from "../engine";
import type { HiveConfig } from "./load-config";
import { loadCache, telemetryRecorder, conversationStore } from "../telemetry";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");
const indexPath = join(__dirname, "index.html");
const assetsDir = join(__dirname, "assets");

const MIME_TYPES: Record<string, string> = {
  js: "text/javascript",
  css: "text/css",
  html: "text/html",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  woff2: "font/woff2",
};

export function createServer(config: HiveConfig) {
  const server = Fastify({ logger: false });

  server.get("/assets/*", async (request, reply) => {
    const filename = (request.params as Record<string, string>)["*"];
    const filePath = join(assetsDir, filename);
    if (!existsSync(filePath)) return reply.status(404).send();
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    reply.type(MIME_TYPES[ext] || "application/octet-stream");
    return reply.send(readFileSync(filePath));
  });

  server.get("/", async (_request, reply) => {
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, "utf-8");
      reply.type("text/html");
      return reply.send(html);
    }
    return reply.status(404).send({ error: "UI not found" });
  });

  server.post("/v1/chat/completions", async (request, reply) => {
    logger.info(`POST /v1/chat/completions`);
    const result = await hiveCore.handleChatCompletion(
      request.body as Record<string, unknown>,
      request.headers
    );

    if (!result.success) {
      logger.error(
        `chat completion failed: ${result.error} (${result.statusCode})`
      );
      return reply
        .status(result.statusCode ?? 500)
        .send({ error: result.error });
    }

    logger.info(
      `chat completion success → routing via ${result.provider} (model: ${result.model})`
    );
    reply.header("Content-Type", "text/event-stream");
    return reply.send(result.stream);
  });

  server.get("/health", async (_request, reply) => {
    reply.send({ status: "ok" });
  });

  server.get("/api/providers", async (_request, reply) => {
    const states = await hiveCore.getProviderStates();
    const configProviders = hiveCore.getProviders();

    const providers = configProviders.flatMap((p) => {
      const matchingStates = states.filter((s) => s.provider === p.name);
      const keyConfigured = !!process.env[p.apiKeyEnvVar];

      if (matchingStates.length > 0) {
        return matchingStates.map((s) => ({
          name: s.provider,
          baseUrl: p.baseUrl,
          model: s.model,
          models: p.models,
          keyConfigured,
          stabilityScore: s.stabilityScore,
          p95Latency: s.p95Latency,
          recentSuccessRate: s.recentSuccessRate,
          requestCount: s.requestCount,
          meanTokensPerSecond: s.meanTokensPerSecond,
        }));
      }

      return [
        {
          name: p.name,
          baseUrl: p.baseUrl,
          model: p.defaultModel,
          models: p.models,
          keyConfigured,
          stabilityScore: 0,
          p95Latency: 0,
          recentSuccessRate: 0,
          requestCount: 0,
          meanTokensPerSecond: 0,
        },
      ];
    });

    const lastUsed = hiveCore.getLastUsed();

    reply.send({
      providers,
      serverPort: config.port,
      serverHost: config.host,
      lastProvider: lastUsed.provider,
      lastModel: lastUsed.model,
    });
  });

  server.get("/api/metrics", async (_request, reply) => {
    const cache = await loadCache();
    reply.send({
      metrics: cache.metrics,
      pending: telemetryRecorder.getPendingCount(),
    });
  });

  server.get("/api/conversations", async (_request, reply) => {
    reply.send({
      conversations: conversationStore.getConversations(),
    });
  });

  return server;
}

export function listen(
  server: ReturnType<typeof createServer>,
  config: HiveConfig
): void {
  server.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      logger.error(`failed to start server: ${err.message}`);
      process.exit(1);
    }
    logger.info(`listening on http://${config.host}:${config.port}`);
  });
}
