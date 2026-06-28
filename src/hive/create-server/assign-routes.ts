import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FastifyServer } from "../create-server";
import { addLogListener, getRecentLogs, logger } from "../shared/logger";
import { hiveCore } from "../../engine";
import {
  loadCache,
  telemetryRecorder,
  conversationStore,
} from "../../telemetry";
import { routingMemory } from "../../proxy";
import { SERVER_CONFIG } from "../server-config";
import {
  getOverride,
  setOverride as setManualOverride,
  clearOverride as clearManualOverride,
} from "../manual-override";
import type { WebSocket } from "ws";

export function assignRoutes(server: FastifyServer) {
  const activeSockets = new Set<WebSocket>();

  async function buildProvidersPayload() {
    const configProviders = hiveCore.getProviders();
    const routingStates = routingMemory.getStates();

    const states = await hiveCore.getProviderStates();
    return configProviders.flatMap((p) => {
      const keyConfigured = !!process.env[p.apiKeyEnvVar];
      const providerModels = p.models.length > 0 ? p.models : [p.defaultModel];

      return providerModels.map((model) => {
        const matchingState =
          states.find((s) => s.provider === p.name && s.model === model) ??
          null;
        const compKey = `${p.name}:${model}`;

        return {
          name: p.name,
          displayName: p.displayName,
          baseUrl: p.baseUrl,
          model,
          models: p.models,
          keyConfigured,
          stabilityScore: matchingState?.stabilityScore ?? 0,
          p95Latency: matchingState?.p95Latency ?? 0,
          recentSuccessRate: matchingState?.recentSuccessRate ?? 0,
          requestCount: matchingState?.requestCount ?? 0,
          meanTokensPerSecond: matchingState?.meanTokensPerSecond ?? null,
          trippedUntil: routingStates.trippedBreakers[compKey] || null,
          disabledFeatures: routingStates.disabledFeatures[compKey],
        };
      });
    });
  }

  const getTelemetryPayload = async () => {
    const configProviders = hiveCore.getProviders();
    const providers = await buildProvidersPayload();

    const lastUsed = hiveCore.getLastUsed();
    const cache = await loadCache();
    const conversations = conversationStore.getConversations();

    const overrideState = getOverride();

    const availableProviders = configProviders.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      models: [...p.models],
      keyConfigured: !!process.env[p.apiKeyEnvVar],
    }));

    const bestEntry =
      providers
        .filter((p) => p.keyConfigured)
        .sort((a, b) => b.stabilityScore - a.stabilityScore)[0] ?? null;

    const bestProvider = bestEntry.name;
    const bestModel = bestEntry.model;
    const bestScore = bestEntry.stabilityScore;

    const overrideProvider = overrideState ? overrideState.provider : null;
    const overrideModel = overrideState ? overrideState.model : null;

    return {
      type: "update",
      data: {
        providers,
        serverPort: String(SERVER_CONFIG.port),
        serverHost: SERVER_CONFIG.host,
        lastProvider: lastUsed.provider,
        lastModel: lastUsed.model,
        overrideActive: overrideState !== null,
        overrideProvider,
        overrideModel,
        availableProviders,
        metrics: cache.metrics,
        pending: telemetryRecorder.getPendingCount(),
        conversations,
        bestProvider,
        bestModel,
        bestScore,
      },
    };
  };

  const broadcastTelemetry = async () => {
    if (activeSockets.size === 0) return;
    try {
      const payload = JSON.stringify(await getTelemetryPayload());
      for (const socket of activeSockets) {
        socket.send(payload);
      }
    } catch (err) {
      logger.error("broadcastTelemetry failed", err);
    }
  };

  // Broadcast metrics when updated
  telemetryRecorder.onChange(() => {
    void broadcastTelemetry();
  });

  // Broadcast logs when received
  addLogListener((log) => {
    if (activeSockets.size === 0) return;
    const payload = JSON.stringify({ type: "log", data: log });
    for (const socket of activeSockets) {
      try {
        socket.send(payload);
      } catch {
        // ignore
      }
    }
  });

  server.get("/ws", { websocket: true }, (socket) => {
    activeSockets.add(socket);

    // Send initial state immediately
    void (async () => {
      try {
        const initPayload = await getTelemetryPayload();
        socket.send(JSON.stringify({ ...initPayload, type: "init" }));

        // Send recent logs
        const recentLogs = getRecentLogs();
        for (const log of recentLogs) {
          socket.send(JSON.stringify({ type: "log", data: log }));
        }
      } catch (err) {
        logger.error("failed to send initial ws payload", err);
      }
    })();

    socket.on("close", () => {
      activeSockets.delete(socket);
    });

    socket.on("message", (msg) => {
      try {
        const text =
          typeof msg === "string"
            ? msg
            : Buffer.isBuffer(msg)
              ? msg.toString()
              : JSON.stringify(msg);
        const parsed = JSON.parse(text) as Record<string, unknown> | null;
        if (parsed?.type === "override") {
          const provider = parsed.provider;
          const model = parsed.model;
          if (typeof provider === "string" && typeof model === "string") {
            setManualOverride(provider, model);
            logger.debug(`override set: ${provider} / ${model}`);
          } else {
            clearManualOverride();
            logger.debug("override cleared");
          }
          void broadcastTelemetry();
        }
      } catch {
        logger.debug(
          `received WS message: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`
        );
      }
    });
  });

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
    const requestId = crypto.randomUUID();
    logger.info(`request ${requestId} — handling chat completion`);
    const result = await hiveCore.handleChatCompletion(
      request.body as Record<string, unknown>,
      request.headers
    );

    if (!result.success) {
      logger.error(
        `request ${requestId} — chat completion failed`,
        `${result.error ?? ""} (${String(result.statusCode ?? "")})`
      );
      return reply
        .status(result.statusCode ?? 500)
        .send({ error: result.error });
    }

    logger.info(
      `request ${requestId} — chat completion success → routing via ${result.provider ?? ""} (model: ${result.model ?? ""})`
    );
    reply.header("Content-Type", "text/event-stream");
    return reply.send(result.stream);
  });

  server.get("/health", async (_request, reply) => {
    reply.send({ status: "ok" });
  });

  server.get("/api/providers", async (_request, reply) => {
    const providers = await buildProvidersPayload();

    const lastUsed = hiveCore.getLastUsed();

    reply.send({
      providers,
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
