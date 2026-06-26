import type { IncomingHttpHeaders } from "node:http";
import { PassThrough } from "node:stream";
import type { Provider } from "./providers/registry";
import { buildChatEndpoint } from "./providers/registry";
import { loadConfig } from "./hive/load-config";
import {
  telemetryRecorder,
  startHeartbeat,
  loadCache,
  applyWindow,
  conversationStore,
  type ProviderModelNode,
  type RequestMetric,
} from "./telemetry";
import {
  mutateRequest,
  routeRequest,
  executeProxyRequest,
  routingMemory,
  ProxyResponse,
} from "./proxy";
import { discoverAndCacheModels } from "./providers/discovery";
import { generateId } from "./id";

type ChatCompletionResult = {
  success: boolean;
  stream?: PassThrough;
  provider?: string;

  model?: string;
  statusCode?: number;
  error?: string;
};

type Message = {
  role: string;
  content: string;
  reasoning_content?: string;
  tool_calls?: unknown[];
};

function sanitizePayloadForProvider(
  providerName: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  const msgs = cloned.messages;
  if (!Array.isArray(msgs)) return cloned;
  if (providerName !== "opencode-zen") {
    cloned.messages = msgs.map((msg: unknown) => {
      const m = msg as Message;
      if (m.role === "assistant" && "reasoning_content" in m) {
        if (m.reasoning_content && typeof m.content === "string") {
          m.content = `[Thought: ${m.reasoning_content}]\n\n${m.content}`;
        }
        delete m.reasoning_content;
      }
      return m;
    });
  }
  return cloned;
}

function extractRequiredFeatures(parsed: Record<string, unknown>): string[] {
  const features: string[] = [];
  if (
    parsed.tools ||
    (Array.isArray(parsed.messages) &&
      (parsed.messages as Array<Record<string, unknown>>).some(
        (m) => m.tool_calls
      ))
  ) {
    features.push("tools");
  }
  return features;
}

export class HiveCore {
  private providers: Provider[] = [];
  private config: ReturnType<typeof loadConfig>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private lastProvider: string | null = null;
  private lastModel: string | null = null;

  constructor() {
    this.config = loadConfig();
    this.providers = this.config.providers.map((p) => ({
      name: p.name,
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
    } catch {
      // Cache load failure is non-fatal
    }
  }

  private async triggerBackgroundDiscovery(): Promise<void> {
    try {
      const cache = await discoverAndCacheModels();
      for (const p of this.providers) {
        const cached = cache.providers.find((cp) => cp.name === p.name);
        if (cached) {
          p.models = [...cached.models];
          p.defaultModel = cached.defaultModel;
        }
      }
    } catch {
      // Background discovery is non-blocking and non-fatal
    }
  }

  async handleChatCompletion(
    body: string | Record<string, unknown>,
    incomingHeaders: Record<string, string | string[] | undefined> = {}
  ): Promise<ChatCompletionResult> {
    const parsed:
      | Record<string, unknown>
      | { messages?: Array<Record<string, unknown>> } =
      typeof body === "string"
        ? (JSON.parse(body) as Record<string, unknown>)
        : body;

    const qualified = this.providers.filter((p) => {
      const key = process.env[p.apiKeyEnvVar];
      return key && key.length > 0;
    });

    if (qualified.length === 0) {
      return {
        success: false,
        statusCode: 503,
        error: "No configured providers available — set a provider API key",
      };
    }

    const cache = await loadCache();
    const payloadStr = JSON.stringify(parsed);
    const requestId = generateId();
    const sessionId = requestId;
    const messages = (parsed as Record<string, unknown>).messages ?? [];
    conversationStore.startConversation(
      requestId,
      Array.isArray(messages)
        ? (messages as { role: string; content: string }[])
        : []
    );

    const nodes: ProviderModelNode[] = qualified.map((p) => ({
      providerName: p.name,
      modelName: p.defaultModel,
    }));

    const requiredFeatures = extractRequiredFeatures(parsed);

    const headers: IncomingHttpHeaders = Object.fromEntries(
      Object.entries(incomingHeaders).filter(
        ([key]) =>
          !["authorization", "host", "content-length", "content-type"].includes(
            key.toLowerCase()
          )
      )
    );

    const getMetricsForNode = (compoundKey: string): RequestMetric[] => {
      const all = cache.metrics.filter(
        (m) => `${m.provider}:${m.model}` === compoundKey
      );
      return applyWindow(all);
    };

    const dispatchRequest = async (
      node: ProviderModelNode,
      payload: string
    ): Promise<ProxyResponse> => {
      const provider = qualified.find((p) => p.name === node.providerName);
      if (!provider) return ProxyResponse.error(500, "config-error");

      const sanitized = sanitizePayloadForProvider(
        node.providerName,
        JSON.parse(payload) as Record<string, unknown>
      );

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

      return result.proxyResponse;
    };

    try {
      const response = await executeProxyRequest({
        nodes,
        originalPayload: payloadStr,
        requiredFeatures,
        getMetricsForNode,
        dispatchRequest,
        sessionId,
      });

      if (response.isOk()) {
        const lastKey = routingMemory.getNodeAffinity(sessionId);
        this.lastProvider =
          nodes.find((n) => lastKey === `${n.providerName}:${n.modelName}`)
            ?.providerName ?? null;
        this.lastModel =
          nodes.find((n) => lastKey === `${n.providerName}:${n.modelName}`)
            ?.modelName ?? null;

        return {
          success: true,
          stream: response.getStream() as PassThrough,
          provider: this.lastProvider ?? undefined,
          model: this.lastModel ?? undefined,
          statusCode: response.status,
        };
      }

      return {
        success: false,
        statusCode: response.status,
        error: "Upstream returned no stream",
      };
    } catch {
      return {
        success: false,
        statusCode: 503,
        error: "All providers failed",
      };
    }
  }

  async getProviderStates() {
    const cache = await loadCache();
    return cache.scores.map((s) => ({
      provider: s.provider,
      model: s.model,
      enabled: true,
      stabilityScore: s.score,
      p95Latency: s.derived.p95Ttft,
      recentSuccessRate: s.derived.successRate,
      requestCount: s.derived.requestCount,
      meanTokensPerSecond: s.derived.meanTokensPerSecond,
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
          });
        } catch {
          // Heartbeat failures are non-fatal
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

  getProviders(): Provider[] {
    return this.providers;
  }

  getLastUsed(): { provider: string | null; model: string | null } {
    return { provider: this.lastProvider, model: this.lastModel };
  }
}

export const hiveCore = new HiveCore();
