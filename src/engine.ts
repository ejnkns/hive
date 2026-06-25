import type { IncomingHttpHeaders } from "node:http";
import { PassThrough } from "node:stream";
import type { Provider } from "./providers/registry";
import { buildChatEndpoint } from "./providers/registry";
import { loadConfig } from "./hive/load-config";
import { telemetryRecorder, startHeartbeat, loadCache } from "./telemetry";
import { failover } from "./proxy/failover";
import { sortByPriority } from "./providers";
import { mutateRequest } from "./proxy/mutate-request";
import { routeRequest } from "./proxy/route-request";
import { discoverAndCacheModels } from "./providers/discovery";

export type ChatCompletionResult = {
  success: boolean;
  stream?: PassThrough;
  provider?: string;
  model?: string;
  statusCode?: number;
  error?: string;
};

export class HiveCore {
  private providers: Provider[] = [];
  private config: ReturnType<typeof loadConfig>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;

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
    this.triggerBackgroundDiscovery();
    this.discoveryTimer = setInterval(
      () => {
        this.triggerBackgroundDiscovery();
      },
      60 * 60 * 1000,
    );
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
    incomingHeaders: Record<string, any> = {},
  ): Promise<ChatCompletionResult> {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;

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
    const modelScores = cache.scores;

    const prioritized = sortByPriority(
      qualified.map((p) => {
        const ms = modelScores.find(
          (s) => s.provider === p.name && s.model === p.defaultModel,
        );
        return {
          provider: p.name,
          model: p.defaultModel,
          enabled: true,
          stabilityScore: ms?.score ?? 50,
        };
      }),
    );

    const sorted = prioritized
      .map((ps) => qualified.find((p) => p.name === ps.provider))
      .filter((p): p is Provider => p !== undefined);

    const headers: IncomingHttpHeaders = Object.fromEntries(
      Object.entries(incomingHeaders).filter(
        ([key]) =>
          !["authorization", "host", "content-length", "content-type"].includes(
            key.toLowerCase(),
          ),
      ),
    );
    const result = await failover(sorted, headers, JSON.stringify(parsed));

    if (!result.success) {
      return {
        success: false,
        statusCode: result.statusCode ?? 503,
        error: "All providers failed",
      };
    }

    return {
      success: true,
      stream: result.stream!,
      provider: result.provider!,
      model: result.model!,
      statusCode: result.statusCode,
    };
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

          const mutated = mutateRequest(
            {} as IncomingHttpHeaders,
            body,
            provider,
            provider.defaultModel,
          );
          await routeRequest(
            buildChatEndpoint(provider.baseUrl),
            mutated,
            5000,
            provider.name,
            provider.defaultModel,
          );
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
}

export const hiveCore = new HiveCore();
