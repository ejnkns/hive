import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addLogListener, getRecentLogs, logger } from "shared/logger";
import { getServerConfig } from "shared/server-config";
import { conversationStore, loadCache, telemetryRecorder } from "telemetry";
import type { WebSocket } from "ws";
import type { FastifyServer } from "../create-server";
import {
  disableProvider,
  enableProvider,
  isProviderDisabled,
} from "../disabled-providers-state";
import { clearOverride, getOverride, setOverride } from "../override";
import type { Provider } from "../providers";
import { getModelId } from "../providers";
import type { ChatCompletionResult, ProviderState } from "../proxy";
import {
  getSessionSnapshot,
  routingMemory,
  setAggregatorCallbacks,
} from "../proxy";
import {
  getModelPriority,
  saveModelPriority,
} from "../proxy/model-priority-config";
import { getCanvasState, setCanvasState } from "./assign-routes/canvas-state";

export type RouteDeps = {
  getProviders: () => ReadonlyArray<Provider>;
  getProviderStates: () => Promise<ProviderState[]>;
  getLastUsed: () => { provider: string | null; model: string | null };
  handleChatCompletion: (
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
    signal?: AbortSignal
  ) => Promise<ChatCompletionResult>;
};

export function assignRoutes(server: FastifyServer, deps: RouteDeps) {
  const activeSockets = new Set<WebSocket>();

  async function buildProvidersPayload() {
    const configProviders = deps.getProviders();
    const routingStates = routingMemory.getStates();

    const states = await deps.getProviderStates();
    return configProviders.flatMap((p) => {
      const keyConfigured = !!process.env[p.apiKeyEnvVar];
      const providerModels = p.models.length > 0 ? p.models : [p.defaultModel];

      return providerModels.map((entry) => {
        const model = getModelId(entry);
        const matchingState =
          states.find((s) => s.provider === p.name && s.model === model) ??
          null;
        const compKey = `${p.name}:${model}`;

        return {
          name: p.name,
          displayName: p.displayName,
          chatEndpoint: p.chatEndpoint,
          model,
          models: p.models.map(getModelId),
          keyConfigured,
          stabilityScore: matchingState?.stabilityScore ?? 0,
          subscores: matchingState?.subscores ?? {
            latency: 0,
            throughput: 0,
            reliability: 0,
            quality: 0,
            contextWindow: 0,
          },
          p95Latency: matchingState?.p95Latency ?? 0,
          recentSuccessRate: matchingState?.recentSuccessRate ?? 0,
          requestCount: matchingState?.requestCount ?? 0,
          meanTokensPerSecond: matchingState?.meanTokensPerSecond ?? null,
          truncationRate: matchingState?.truncationRate ?? 0,
          refusalRate: matchingState?.refusalRate ?? 0,
          contentFilterRate: matchingState?.contentFilterRate ?? 0,
          trippedUntil: routingStates.trippedBreakers[compKey] || null,
          disabledFeatures: routingStates.disabledFeatures[compKey],
          disabled: isProviderDisabled(p.name),
        };
      });
    });
  }

  function broadcast(msg: object) {
    if (activeSockets.size === 0) return;
    const payload = JSON.stringify(msg);
    for (const socket of activeSockets) {
      try {
        socket.send(payload);
      } catch {
        // ignore
      }
    }
  }

  async function buildInitPayload() {
    const configProviders = deps.getProviders();
    const providers = await buildProvidersPayload();
    const cache = await loadCache();
    const conversations = conversationStore.getConversations();

    const overrideState = getOverride();

    const availableProviders = configProviders.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      models: [
        ...new Set(
          (p.models.length > 0 ? p.models : [p.defaultModel]).map((entry) =>
            getModelId(entry)
          )
        ),
      ],
      keyConfigured: !!process.env[p.apiKeyEnvVar],
      disabled: isProviderDisabled(p.name),
    }));

    const bestEntry =
      providers
        .filter((p) => p.keyConfigured)
        .sort((a, b) => b.stabilityScore - a.stabilityScore)[0] ?? null;

    const okCount = cache.metrics.filter((r) => r.success).length;
    const rate =
      cache.metrics.length > 0
        ? Math.round((okCount / cache.metrics.length) * 100)
        : null;
    const flights = cache.metrics.filter((r) => r.success).map((r) => r.ttft);
    const avg =
      flights.length > 0
        ? Math.round(flights.reduce((a, b) => a + b, 0) / flights.length)
        : null;
    const names = new Set(
      providers.filter((x) => x.keyConfigured).map((x) => x.name)
    );

    return {
      providers,
      availableProviders,
      metrics: cache.metrics.map((m) => {
        const conv = conversations.find((c) => c.requestId === m.requestId);
        return { ...m, prompt: conv?.prompt, responseText: conv?.responseText };
      }),
      override: {
        active: overrideState !== null,
        provider: overrideState ? overrideState.provider : null,
        model: overrideState ? overrideState.model : null,
      },
      modelPriorityConfig: getModelPriority(),
      serverHost: getServerConfig().host,
      serverPort: String(getServerConfig().port),
      routingStrategy: process.env.HIVE_ROUTING_STRATEGY || "balanced",
      contextWindowWeight: Number(process.env.HIVE_CONTEXT_WINDOW_WEIGHT) || 0,
      pending: telemetryRecorder.getPendingCount(),
      stats: {
        traffic: cache.metrics.length,
        successRate: rate,
        activeProviders: names.size,
        avgLatency: avg,
        bestProvider: bestEntry ? bestEntry.name : null,
        bestModel: bestEntry ? bestEntry.model : null,
        bestScore: bestEntry ? bestEntry.stabilityScore : null,
      },
    };
  }

  async function broadcastOverrideUpdate() {
    const overrideState = getOverride();
    broadcast({
      type: "override_update",
      override: {
        active: overrideState !== null,
        provider: overrideState ? overrideState.provider : null,
        model: overrideState ? overrideState.model : null,
      },
    });
  }

  function broadcastModelPriorityUpdate() {
    broadcast({
      type: "model_priority_update",
      config: getModelPriority(),
    });
  }

  async function broadcastProviderUpdate() {
    broadcast({
      type: "provider_update",
      providers: await buildProvidersPayload(),
    });
  }

  async function broadcastAvailableProvidersUpdate() {
    const configProviders = deps.getProviders();
    broadcast({
      type: "available_providers_update",
      availableProviders: configProviders.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        models: [
          ...new Set(
            (p.models.length > 0 ? p.models : [p.defaultModel]).map((entry) =>
              getModelId(entry)
            )
          ),
        ],
        keyConfigured: !!process.env[p.apiKeyEnvVar],
        disabled: isProviderDisabled(p.name),
      })),
    });
  }

  async function broadcastMetricsUpdate() {
    const cache = await loadCache();
    const conversations = conversationStore.getConversations();
    broadcast({
      type: "metrics_update",
      metrics: cache.metrics.map((m) => {
        const conv = conversations.find((c) => c.requestId === m.requestId);
        return { ...m, prompt: conv?.prompt, responseText: conv?.responseText };
      }),
    });
  }

  // Broadcast metrics when updated
  telemetryRecorder.onChange(() => {
    void broadcastMetricsUpdate();
  });

  // Broadcast logs when received
  addLogListener((log) => {
    broadcast({ type: "log", data: log });
  });

  setAggregatorCallbacks({
    onSnapshot: (snapshot) => {
      if (activeSockets.size === 0) return;
      const payload = JSON.stringify({
        type: "session_snapshot",
        sessions: snapshot,
      });
      for (const socket of activeSockets) {
        try {
          socket.send(payload);
        } catch {
          // ignore
        }
      }
    },
    onPipelineState: (event) => {
      if (activeSockets.size === 0) return;
      const payload = JSON.stringify(event);
      for (const socket of activeSockets) {
        try {
          socket.send(payload);
        } catch {
          // ignore
        }
      }
    },
  });

  server.get("/ws", { websocket: true }, (socket) => {
    activeSockets.add(socket);

    void (async () => {
      try {
        const init = await buildInitPayload();
        const sessions = getSessionSnapshot();
        const logs = getRecentLogs();
        socket.send(
          JSON.stringify({
            type: "init",
            ...init,
            sessions,
            logs,
          })
        );
      } catch (err) {
        logger.error("failed to send ws connect init", err);
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
        // JSON.parse returns unknown; downstream validates with typeof checks
        const parsed = JSON.parse(text) as Record<string, unknown> | null;
        if (parsed?.type === "override") {
          const provider = parsed.provider;
          const model = parsed.model;
          const enabled = parsed.enabled !== false;
          if (
            typeof provider === "string" &&
            typeof model === "string" &&
            enabled
          ) {
            setOverride(provider, model);
            logger.debug(`override set: ${provider} / ${model}`);
          } else {
            clearOverride();
            logger.debug("override cleared");
          }
          void broadcastOverrideUpdate();
        }
        if (parsed?.type === "toggle_provider") {
          const provider = parsed.provider;
          const disabled = parsed.disabled;
          if (typeof provider === "string" && typeof disabled === "boolean") {
            if (disabled) {
              disableProvider(provider);
              const override = getOverride();
              if (override?.provider === provider) {
                clearOverride();
                logger.debug(
                  `override cleared (provider disabled): ${provider}`
                );
              }
              logger.debug(`provider disabled: ${provider}`);
            } else {
              enableProvider(provider);
              logger.debug(`provider enabled: ${provider}`);
            }
            void broadcastProviderUpdate();
            void broadcastAvailableProvidersUpdate();
          }
        }
        if (parsed?.type === "session_detail") {
          if (
            typeof parsed.sessionId === "string" &&
            typeof parsed.requestId === "string"
          ) {
            const sessions = getSessionSnapshot();
            const allSessions = [...sessions.active, ...sessions.completed];
            const session = allSessions.find(
              (s) => s.sessionId === parsed.sessionId
            );
            if (session) {
              const request = session.requests.find(
                (r) => r.requestId === parsed.requestId
              );
              if (request) {
                socket.send(
                  JSON.stringify({
                    type: "session_detail",
                    requestId: request.requestId,
                    conversationPrompt: request.conversationPrompt ?? [],
                    responseText: request.responseText ?? "",
                  })
                );
              }
            }
          }
        }
        if (parsed?.type === "update_model_priority") {
          const config = parsed.config as Record<string, unknown> | undefined;
          if (
            config &&
            Array.isArray(config.modelPriority) &&
            typeof config.modelPriority[0] === "string"
          ) {
            saveModelPriority({
              modelPriority: config.modelPriority as string[],
              providerPriority: Array.isArray(config.providerPriority)
                ? (config.providerPriority as string[])
                : undefined,
            });
            broadcastModelPriorityUpdate();
          }
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
    const filePath = join(uiBuildDir, "assets", filename);
    if (!existsSync(filePath)) return reply.status(404).send();
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    reply.type(MIME_TYPES[ext] || "application/octet-stream");
    return reply.send(readFileSync(filePath));
  });

  server.get("/", async (_request, reply) => {
    console.log(`Serving UI from: ${indexHtmlPath}`);
    if (existsSync(indexHtmlPath)) {
      const html = readFileSync(indexHtmlPath, "utf-8");
      reply.type("text/html");
      return reply.send(html);
    }
    return reply.status(404).send({ error: "UI not found" });
  });

  server.get("/api-spec", async (_request, reply) => {
    console.log(`Serving API spec from: ${specHtmlPath}`);
    if (!existsSync(specHtmlPath)) {
      return reply
        .status(404)
        .send({ error: `API spec not found ${specHtmlPath}` });
    }
    const html = readFileSync(specHtmlPath, "utf-8");
    reply.type("text/html");
    return reply.send(html);
  });

  server.get("/api-spec.yaml", async (_request, reply) => {
    if (!existsSync(specYamlPath)) {
      return reply
        .status(404)
        .send({ error: `API spec YAML not found ${specYamlPath}` });
    }
    const yaml = readFileSync(specYamlPath, "utf-8");
    reply.type("application/x-yaml");
    return reply.send(yaml);
  });

  // API endpoints
  server.get("/health", async (_request, reply) => {
    reply.send({ status: "ok" });
  });

  server.post("/v1/chat/completions", async (request, reply) => {
    const requestId = crypto.randomUUID();
    logger.info(`request ${requestId} — handling chat completion`);
    const controller = new AbortController();
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    // Fastify body is typed as unknown; API contract guarantees JSON object
    const result = await deps.handleChatCompletion(
      request.body as Record<string, unknown>,
      request.headers,
      controller.signal
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
    reply.header("Cache-Control", "no-cache");
    if (result.provider) reply.header("X-Hive-Provider", result.provider);
    if (result.model) reply.header("X-Hive-Model", result.model);
    return reply.send(result.stream);
  });

  server.get("/api/providers", async (_request, reply) => {
    const providers = await buildProvidersPayload();

    const lastUsed = deps.getLastUsed();
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

  server.get("/api/model-priority", async (_request, reply) => {
    reply.send({ config: getModelPriority() });
  });

  server.put("/api/model-priority", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    if (
      !body ||
      !Array.isArray(body.modelPriority) ||
      body.modelPriority.length === 0
    ) {
      return reply
        .status(400)
        .send({ error: "modelPriority must be a non-empty array" });
    }
    const config = {
      modelPriority: body.modelPriority as string[],
      providerPriority: Array.isArray(body.providerPriority)
        ? (body.providerPriority as string[])
        : undefined,
    };
    saveModelPriority(config);
    broadcastModelPriorityUpdate();
    reply.send({ ok: true });
  });

  server.get("/api/canvas-state/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const state = getCanvasState(sessionId);
    if (!state) {
      return reply.status(404).send({ error: "not found" });
    }
    return reply.send(state);
  });

  server.post("/api/canvas-state/:sessionId", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const body = request.body as {
      html?: string;
      chatHistory?: Array<{ role: string; content: string }>;
    };
    setCanvasState(sessionId, {
      html: body.html ?? null,
      chatHistory: body.chatHistory ?? [],
    });
    return reply.send({ ok: true });
  });

  return server;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uiBuildDir = join(__dirname, "ui");
const indexHtmlPath = join(uiBuildDir, "index.html");
const specHtmlPath = join(__dirname, "static", "api-spec.html");
const specYamlPath = join(__dirname, "static", "api-spec.yaml");
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
