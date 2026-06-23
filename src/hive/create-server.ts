import Fastify from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./shared/logger";
import { hiveCore } from "../engine";
import type { HiveConfig } from "./load-config";
import { loadState } from "../telemetry";
import { telemetryRecorder } from "../telemetry/recorder";

export function createServer(config: HiveConfig) {
  const server = Fastify({ logger: false });

  server.post("/v1/chat/completions", async (request, reply) => {
    logger.info(`POST /v1/chat/completions`);
    const result = await hiveCore.handleChatCompletion(
      request.body as Record<string, unknown>,
    );

    if (!result.success) {
      logger.error(
        `chat completion failed: ${result.error} (${result.statusCode})`,
      );
      return reply
        .status(result.statusCode ?? 500)
        .send({ error: result.error });
    }

    logger.info(
      `chat completion success → routing via ${result.provider} (model: ${result.model})`,
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

    const providers = configProviders.map((p) => {
      const state = states.find((s) => s.provider === p.name);
      const keyConfigured = !!process.env[p.apiKeyEnvVar];

      return {
        name: p.name,
        baseUrl: p.baseUrl,
        defaultModel: p.defaultModel,
        models: p.models,
        keyConfigured,
        stabilityScore: state?.stabilityScore ?? 0,
        p95Latency: state?.p95Latency ?? 0,
        recentSuccessRate: state?.recentSuccessRate ?? 0,
        requestCount: 0,
      };
    });

    const state = await loadState();
    providers.forEach((p) => {
      p.requestCount = state.metrics.filter(
        (m) => m.provider === p.name,
      ).length;
    });

    reply.send({
      providers,
      serverPort: config.port,
      serverHost: config.host,
    });
  });

  server.get("/api/metrics", async (_request, reply) => {
    const state = await loadState();
    reply.send({
      metrics: state.metrics,
      pending: telemetryRecorder.getPendingCount(),
    });
  });

  return server;
}

export function listen(
  server: ReturnType<typeof createServer>,
  config: HiveConfig,
): void {
  server.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      logger.error(`failed to start server: ${err.message}`);
      process.exit(1);
    }
    logger.info(`listening on http://${config.host}:${config.port}`);
  });
}
