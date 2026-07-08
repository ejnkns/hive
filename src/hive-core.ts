import type { IncomingHttpHeaders } from "node:http";
import type { PassThrough } from "node:stream";
import { buildPromptPreview } from "./hive-core/build-prompt-preview";
import type { ChatCompletionResult } from "./hive-core/chat-completion-result";
import { detectEditLoop } from "./hive-core/detect-edit-loop";
import { detectToolLoop } from "./hive-core/detect-tool-loop";
import { dispatchRequest } from "./hive-core/dispatch-request";
import { extractRequiredFeatures } from "./hive-core/extract-required-features";
import { generateId } from "./hive-core/generateId";
import { getMetricsForNode } from "./hive-core/get-metrics-for-node";
import type { Message } from "./hive-core/message";
import type { ProviderState } from "./hive-core/provider-state";
import { resolveSessionId } from "./hive-core/resolve-session-id";
import {
  buildChatEndpoint,
  discoverAndCacheModels,
  getModelId,
  type Provider,
  providers,
} from "./providers";
import {
  executeProxyRequest,
  mutateRequest,
  type ProxyResponse,
  routeRequest,
  routingMemory,
} from "./proxy";
import { emitFlowEvent } from "./proxy/flow-events";
import { getOverride, isProviderDisabled, loadProviders } from "./server";
import { logger } from "./shared/logger";
import {
  conversationStore,
  loadCache,
  type Node,
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
      logger.debug(
        `loadLastUsed: ${err instanceof Error ? err.message : String(err)}`
      );
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
      logger.debug(
        `triggerBackgroundDiscovery: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async handleChatCompletion(
    body: string | Record<string, unknown>,
    incomingHeaders: Record<string, string | string[] | undefined> = {}
  ): Promise<ChatCompletionResult> {
    const parsed:
      | Record<string, unknown>
      | { messages?: Array<Record<string, unknown>> } =
      // JSON.parse returns unknown; body is validated JSON string from HTTP
      typeof body === "string"
        ? (JSON.parse(body) as Record<string, unknown>)
        : body;

    const qualified = this.providers.filter((p) => {
      const key = process.env[p.apiKeyEnvVar];
      return key && key.length > 0 && !isProviderDisabled(p.name);
    });

    if (qualified.length === 0) {
      logger.debug(
        "no configured providers available — set a provider API key"
      );
      return {
        success: false,
        statusCode: 503,
        error: "No configured providers available — set a provider API key",
      };
    }

    const cache = await loadCache();
    const requestId = generateId();
    const messages = (parsed as Record<string, unknown>).messages ?? [];
    const typedMessages = Array.isArray(messages)
      ? (messages as Message[])
      : [];

    const sessionId = resolveSessionId(incomingHeaders, typedMessages);

    let toolLoopDetected = false;
    const toolLoop = detectToolLoop(typedMessages);
    if (toolLoop) {
      toolLoopDetected = true;
      (parsed as Record<string, unknown>).messages = [
        ...typedMessages,
        {
          role: "system",
          content: `You have called "${toolLoop.toolName}" with identical arguments repeatedly. You appear to be stuck in a loop. Try a different approach or tool.`,
        },
      ];
    } else {
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
    }
    const payloadStr = JSON.stringify(parsed);

    const lastMsg = typedMessages.at(-1);

    const promptPreview = buildPromptPreview(lastMsg);
    emitFlowEvent({
      type: "request_received",
      requestId,
      sessionId,
      timestamp: Date.now(),
      promptPreview,
      toolLoopDetected,
    });

    const requiredFeatures = extractRequiredFeatures(parsed);

    logger.debug(
      `request ${requestId} — ${String(qualified.length)} qualified providers, ${requiredFeatures.length > 0 ? `required features: [${requiredFeatures.join(", ")}]` : "no required features"}`
    );

    conversationStore.startConversation(
      requestId,
      Array.isArray(messages)
        ? (messages as { role: string; content: string }[])
        : []
    );

    const nodes: Node[] = qualified.map((p) => {
      const defaultEntry = p.models.find(
        (entry) => getModelId(entry) === p.defaultModel
      );
      return {
        providerName: p.name,
        modelName: p.defaultModel,
        maxContextTokens:
          defaultEntry && typeof defaultEntry !== "string"
            ? defaultEntry.contextLength
            : undefined,
      };
    });

    const headers: IncomingHttpHeaders = Object.fromEntries(
      Object.entries(incomingHeaders).filter(
        ([key]) =>
          !["authorization", "host", "content-length", "content-type"].includes(
            key.toLowerCase()
          )
      )
    );

    const boundGetMetricsForNode = (compoundKey: string) =>
      getMetricsForNode(compoundKey, cache);

    const boundDispatchRequest = async (
      node: Node,
      payload: string
    ): Promise<ProxyResponse> =>
      dispatchRequest(node, payload, qualified, headers, requestId);

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
        response = await boundDispatchRequest(overrideNode, payloadStr);
        if (response.isOk()) {
          this.lastProvider = overrideNode.providerName;
          this.lastModel = overrideNode.modelName;
          logger.debug(
            `request ${requestId} — override success via ${this.lastProvider}:${this.lastModel}`
          );
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
        getMetricsForNode: boundGetMetricsForNode,
        dispatchRequest: boundDispatchRequest,
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
      const usedNode =
        nodes.find((n) => lastKey === `${n.providerName}:${n.modelName}`) ??
        null;
      this.lastProvider = usedNode?.providerName ?? null;
      this.lastModel = usedNode?.modelName ?? null;

      logger.debug(
        `request ${requestId} — success via ${this.lastProvider ?? "??"}:${this.lastModel ?? "??"}`
      );

      return {
        success: true,
        stream: response.getStream() as PassThrough,
        provider: this.lastProvider ?? undefined,
        model: this.lastModel ?? undefined,
        statusCode: response.status,
      };
    }

    logger.debug(
      `request ${requestId} — upstream returned no stream (status ${String(response.status)})`
    );

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
      enabled: !isProviderDisabled(s.provider),
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
          logger.debug(
            `heartbeat: ${provider.name} failed: ${err instanceof Error ? err.message : String(err)}`
          );
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

export type { ChatCompletionResult, Message, ProviderState };

export const hiveCore = new HiveCore();
