import type { IncomingHttpHeaders } from "node:http";
import type { PassThrough } from "node:stream";
import { detectEditLoop } from "./hive-core/detect-edit-loop";
import { extractRequiredFeatures } from "./hive-core/extract-required-features";
import { generateId } from "./hive-core/generateId";
import { sanitizePayloadForProvider } from "./hive-core/sanitize-payload-for-provider";
import { buildChatEndpoint, discoverAndCacheModels, getModelId, type Provider, providers } from "./providers";
import { executeProxyRequest, mutateRequest, ProxyResponse, routeRequest, routingMemory } from "./proxy";
import { emitFlowEvent } from "./proxy/flow-events";
import { getOverride, loadProviders } from "./server";
import { logger } from "./shared/logger";
import {
  applySlidingWindow,
  conversationStore,
  loadCache,
  type Node,
  type RequestMetric,
  type SubScores,
  startHeartbeat,
  telemetryRecorder,
} from "./telemetry";

export class HiveCore {
  private initialProviders: ReadonlyArray<Provider>;
  private providers: ReturnType<typeof loadProviders>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private lastProvider: string | null = null;
  private lastModel: string | null = null;

  constructor() {
    this.initialProviders = loadProviders();
    this.providers = this.initialProviders.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      baseUrl: p.baseUrl,
      apiKeyEnvVar: p.apiKeyEnvVar,
      models: [...p.models],
      defaultModel: p.defaultModel,
    }));
  }

  start(): void {
    telemetryRecorder.start();
    this.startHeartbeat();
    void this.loadLastUsed();
    void this.triggerBackgroundDiscovery();
    this.discoveryTimer = setInterval(
      () => {
        void this.triggerBackgroundDiscovery();
      },
      60 * 60 * 1000
    );
  }

  private async loadLastUsed(): Promise<void> {
    try {
      const cache = await loadCache();
      const latest = cache.metrics
        .filter((m) => m.success && m.source === "user")
        .sort((a, b) => b.timestamp - a.timestamp)
        .at(0);
      if (latest !== undefined) {
        this.lastProvider = latest.provider;
        this.lastModel = latest.model;
      }
    } catch (err: unknown) {
      logger.debug(`loadLastUsed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async triggerBackgroundDiscovery(): Promise<void> {
    try {
      const cache = await discoverAndCacheModels(providers);
      for (const p of this.providers) {
        const cached = cache.providers.find((cp) => cp.name === p.name);
        if (cached) {
          p.models = [...cached.models];
          p.defaultModel = cached.defaultModel;
        }
      }
    } catch (err: unknown) {
      logger.debug(`triggerBackgroundDiscovery: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async handleChatCompletion(
    body: string | Record<string, unknown>,
    incomingHeaders: Record<string, string | string[] | undefined> = {}
  ): Promise<ChatCompletionResult> {
    const parsed: Record<string, unknown> | { messages?: Array<Record<string, unknown>> } =
      // JSON.parse returns unknown; body is validated JSON string from HTTP
      typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : body;

    const qualified = this.providers.filter((p) => {
      const key = process.env[p.apiKeyEnvVar];
      return key && key.length > 0;
    });

    if (qualified.length === 0) {
      logger.debug("no configured providers available — set a provider API key");
      return {
        success: false,
        statusCode: 503,
        error: "No configured providers available — set a provider API key",
      };
    }

    const cache = await loadCache();
    const requestId = generateId();
    const sessionId = requestId;
    // parsed is already typed as Record<string, unknown> (body variant union)
    const messages = (parsed as Record<string, unknown>).messages ?? [];
    const typedMessages = Array.isArray(messages) ? (messages as Message[]) : [];
    const editLoop = detectEditLoop(typedMessages);
    if (editLoop) {
      (parsed as Record<string, unknown>).messages = [
        ...typedMessages,
        {
          role: "system",
          content: `The edit tool failed repeatedly on "${editLoop.filePath}". Use the read tool to refresh the file content before attempting more edits.`,
        },
      ];
    }
    const payloadStr = JSON.stringify(parsed);

    const lastUserMsg = typedMessages.filter((m) => m.role === "user").at(-1);
    const promptPreview = typeof lastUserMsg?.content === "string" ? lastUserMsg.content.slice(0, 120) : "";
    emitFlowEvent({ type: "request_received", requestId, timestamp: Date.now(), promptPreview });

    const requiredFeatures = extractRequiredFeatures(parsed);

    logger.debug(
      `request ${requestId} — ${String(qualified.length)} qualified providers, ${requiredFeatures.length > 0 ? `required features: [${requiredFeatures.join(", ")}]` : "no required features"}`
    );

    conversationStore.startConversation(
      requestId,
      Array.isArray(messages) ? (messages as { role: string; content: string }[]) : []
    );

    const nodes: Node[] = qualified.map((p) => {
      const defaultEntry = p.models.find((entry) => getModelId(entry) === p.defaultModel);
      return {
        providerName: p.name,
        modelName: p.defaultModel,
        maxContextTokens: defaultEntry && typeof defaultEntry !== "string" ? defaultEntry.contextLength : undefined,
      };
    });

    const headers: IncomingHttpHeaders = Object.fromEntries(
      Object.entries(incomingHeaders).filter(
        ([key]) => !["authorization", "host", "content-length", "content-type"].includes(key.toLowerCase())
      )
    );

    const getMetricsForNode = (compoundKey: string): RequestMetric[] => {
      const all = cache.metrics.filter((m) => `${m.provider}:${m.model}` === compoundKey);
      return applySlidingWindow(all);
    };

    const dispatchRequest = async (node: Node, payload: string): Promise<ProxyResponse> => {
      const provider = qualified.find((p) => p.name === node.providerName);
      if (!provider) {
        logger.debug(`dispatch: provider config not found for ${node.providerName}`);
        return ProxyResponse.error(500, "config-error");
      }

      // payload is JSON-stringified earlier; shape matches body contract
      const sanitized = sanitizePayloadForProvider(node.providerName, JSON.parse(payload) as Record<string, unknown>);

      const mutated = mutateRequest({
        originalHeaders: headers,
        originalBody: JSON.stringify(sanitized),
        targetProvider: provider,
        targetModel: node.modelName,
      });

      const result = await routeRequest({
        upstreamUrl: buildChatEndpoint(provider.baseUrl),
        mutated,
        timeoutMs: 10000,
        providerName: node.providerName,
        modelName: node.modelName,
        requestId,
      });

      logger.debug(
        `dispatch → ${node.providerName}:${node.modelName} — status ${String(result.proxyResponse.status)}, ttft ${String(result.ttft)}ms`
      );

      return result.proxyResponse;
    };

    // Try manual override first — single-node attempt, fall back to auto-routing if it fails
    const override = getOverride();
    const overrideNode =
      override && qualified.some((p) => p.name === override.provider)
        ? { providerName: override.provider, modelName: override.model }
        : null;

    let response: ProxyResponse | null;
    if (overrideNode) {
      logger.debug(
        `request ${requestId} — trying override node ${overrideNode.providerName}:${overrideNode.modelName}`
      );
      try {
        response = await dispatchRequest(overrideNode, payloadStr);
        if (response.isOk()) {
          this.lastProvider = overrideNode.providerName;
          this.lastModel = overrideNode.modelName;
          logger.debug(`request ${requestId} — override success via ${this.lastProvider}:${this.lastModel}`);
          return {
            success: true,
            // getStream returns Readable; ProxyResponse wraps PassThrough
            stream: response.getStream() as PassThrough,
            provider: this.lastProvider,
            model: this.lastModel,
            statusCode: response.status,
          };
        } else {
          logger.debug(
            `request ${requestId} — override node failed (status ${String(response.status)}), falling back to auto-routing`
          );
        }
      } catch (err: unknown) {
        logger.debug(
          `request ${requestId} — override node threw: ${err instanceof Error ? err.message : String(err)}, falling back to auto-routing`
        );
      }
    }

    try {
      response = await executeProxyRequest({
        nodes,
        originalPayload: payloadStr,
        requiredFeatures,
        getMetricsForNode,
        dispatchRequest,
        sessionId,
      });
    } catch (err: unknown) {
      logger.error(`request ${requestId} — all providers failed`, err);
      return {
        success: false,
        statusCode: 503,
        error: "All providers failed",
      };
    }

    if (response.isOk()) {
      const lastKey = routingMemory.getNodeAffinity(sessionId);
      const usedNode = nodes.find((n) => lastKey === `${n.providerName}:${n.modelName}`) ?? null;
      this.lastProvider = usedNode?.providerName ?? null;
      this.lastModel = usedNode?.modelName ?? null;

      logger.debug(`request ${requestId} — success via ${this.lastProvider ?? "??"}:${this.lastModel ?? "??"}`);

      return {
        success: true,
        stream: response.getStream() as PassThrough,
        provider: this.lastProvider ?? undefined,
        model: this.lastModel ?? undefined,
        statusCode: response.status,
      };
    }

    logger.debug(`request ${requestId} — upstream returned no stream (status ${String(response.status)})`);

    return {
      success: false,
      statusCode: response.status,
      error: "Upstream returned no stream",
    };
  }

  async getProviderStates(): Promise<ProviderState[]> {
    const cache = await loadCache();
    return cache.scores.map((s) => ({
      provider: s.provider,
      model: s.model,
      enabled: true,
      stabilityScore: s.score,
      subscores: s.subscores,
      p95Latency: s.derived.p95Ttft,
      recentSuccessRate: s.derived.successRate,
      requestCount: s.derived.requestCount,
      meanTokensPerSecond: s.derived.meanTokensPerSecond,
      truncationRate: s.derived.truncationRate,
      refusalRate: s.derived.refusalRate,
      contentFilterRate: s.derived.contentFilterRate,
    }));
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = startHeartbeat(async () => {
      for (const provider of this.providers) {
        const key = process.env[provider.apiKeyEnvVar];
        if (!key) continue;

        try {
          const body = JSON.stringify({
            model: provider.defaultModel,
            messages: [{ role: "user", content: "ok" }],
            max_tokens: 1,
          });

          const mutated = mutateRequest({
            originalHeaders: {},
            originalBody: body,
            targetProvider: provider,
            targetModel: provider.defaultModel,
          });
          await routeRequest({
            upstreamUrl: buildChatEndpoint(provider.baseUrl),
            mutated,
            timeoutMs: 5000,
            providerName: provider.name,
            modelName: provider.defaultModel,
            requestId: generateId(),
            source: "heartbeat",
          });
        } catch (err: unknown) {
          logger.debug(`heartbeat: ${provider.name} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
  }

  shutdown(): void {
    telemetryRecorder.stop();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
  }

  getProviders(): ReadonlyArray<Provider> {
    return this.providers;
  }

  getLastUsed(): { provider: string | null; model: string | null } {
    return { provider: this.lastProvider, model: this.lastModel };
  }
}

export type ProviderState = {
  provider: string;
  model: string;
  enabled: boolean;
  stabilityScore: number;
  subscores: SubScores;
  p95Latency: number;
  recentSuccessRate: number;
  requestCount: number;
  meanTokensPerSecond: number | null;
  truncationRate: number;
  refusalRate: number;
  contentFilterRate: number;
};

export type ChatCompletionResult = {
  success: boolean;
  stream?: PassThrough;
  provider?: string;
  model?: string;
  statusCode?: number;
  error?: string;
};

export type Message = {
  role: string;
  content: string;
  reasoning_content?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
};

export const hiveCore = new HiveCore();
