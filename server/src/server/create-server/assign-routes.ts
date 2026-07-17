import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addLogListener, getRecentLogs, logger } from "shared/logger";
import { getServerConfig } from "shared/server-config";
import { conversationStore, loadCache, telemetryRecorder } from "telemetry";
import type { WebSocket } from "ws";
import { getCanvasState, setCanvasState } from "../canvas/canvas-state";
import type { FastifyServer } from "../create-server";
import {
  disableProvider,
  enableProvider,
  isProviderDisabled,
} from "../disabled-providers-state";
import type { HandleOrchestrate } from "../orchestrator/create-handler";
import { clearOverride, getOverride, setOverride } from "../override";
import type { Provider } from "../providers";
import { getModelId } from "../providers";
import type { ChatCompletionResult, ProviderState } from "../proxy";
import {
  type FlowEvent,
  getSessionSnapshot,
  onFlowEvent,
  onSessionPatch,
  routingMemory,
} from "../proxy";

export type RouteDeps = {
  getProviders: () => ReadonlyArray<Provider>;
  getProviderStates: () => Promise<ProviderState[]>;
  getLastUsed: () => { provider: string | null; model: string | null };
  handleChatCompletion: (
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>
  ) => Promise<ChatCompletionResult>;
  handleOrchestrate: HandleOrchestrate;
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

  const getTelemetryPayload = async () => {
    const configProviders = deps.getProviders();
    const providers = await buildProvidersPayload();

    const lastUsed = deps.getLastUsed();
    const cache = await loadCache();
    const conversations = conversationStore.getConversations();

    const overrideState = getOverride();

    const availableProviders = configProviders.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      models: p.models.map((entry) => getModelId(entry)),
      keyConfigured: !!process.env[p.apiKeyEnvVar],
      disabled: isProviderDisabled(p.name),
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
        serverPort: String(getServerConfig().port),
        serverHost: getServerConfig().host,
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
        routingStrategy: process.env.HIVE_ROUTING_STRATEGY || "balanced",
        contextWindowWeight:
          Number(process.env.HIVE_CONTEXT_WINDOW_WEIGHT) || 0,
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

  const flowEventBuffer: FlowEvent[] = [];
  const MAX_FLOW_BUFFER = 50;

  onFlowEvent((event) => {
    flowEventBuffer.push(event);
    if (flowEventBuffer.length > MAX_FLOW_BUFFER) {
      flowEventBuffer.shift();
    }
    if (activeSockets.size === 0) return;
    const payload = JSON.stringify({ type: "flow", data: event });
    for (const socket of activeSockets) {
      try {
        socket.send(payload);
      } catch {
        // ignore
      }
    }
  });

  onSessionPatch((patch) => {
    if (activeSockets.size === 0) return;
    const payload = JSON.stringify({ type: "session_state", data: patch });
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

        // Send buffered flow events
        for (const event of flowEventBuffer) {
          socket.send(JSON.stringify({ type: "flow", data: event }));
        }

        // Send session snapshot
        const sessions = getSessionSnapshot();
        socket.send(JSON.stringify({ type: "session_init", data: sessions }));
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
          void broadcastTelemetry();
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
            void broadcastTelemetry();
          }
        }
        if (parsed?.type === "orchestrate_start") {
          const messages = parsed.messages;
          const sessionId =
            typeof parsed.sessionId === "string"
              ? parsed.sessionId
              : `orch-${crypto.randomUUID().slice(0, 8)}`;
          if (!Array.isArray(messages)) return;
          const send = (data: Record<string, unknown>) => {
            if (socket.readyState === 1) {
              socket.send(JSON.stringify(data));
            }
          };
          void deps
            .handleOrchestrate(
              { messages, max_iterations: parsed.max_iterations },
              { "x-session-id": sessionId },
              (event) => {
                send({
                  type: "orchestrator_event",
                  data: { sessionId, ...event },
                });
              }
            )
            .then((result) => {
              send({
                type: "orchestrator_complete",
                data: {
                  sessionId,
                  messages: result.messages,
                  finish_reason: result.finishReason,
                  final_content: result.finalContent,
                  iterations: result.iterations,
                  error: result.error,
                },
              });
            })
            .catch((err) => {
              send({
                type: "orchestrator_complete",
                data: {
                  sessionId,
                  messages: [],
                  finish_reason: "error",
                  final_content: "",
                  iterations: 0,
                  error: err instanceof Error ? err.message : String(err),
                },
              });
            });
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
    // Fastify body is typed as unknown; API contract guarantees JSON object
    const result = await deps.handleChatCompletion(
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

  server.post("/api/orchestrate", async (request, reply) => {
    const requestId = crypto.randomUUID();
    logger.info(`request ${requestId} — handling orchestrate`);
    const result = await deps.handleOrchestrate(
      request.body as Record<string, unknown>,
      request.headers
    );

    if (result.finishReason === "error") {
      logger.error(
        `request ${requestId} — orchestrate failed`,
        result.error ?? ""
      );
      return reply.status(500).send({ error: result.error });
    }

    logger.info(
      `request ${requestId} — orchestrate done (${result.finishReason}, ${String(result.iterations)} iterations)`
    );
    return reply.send({
      messages: result.messages,
      finish_reason: result.finishReason,
      final_content: result.finalContent,
      iterations: result.iterations,
    });
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
