import type { IncomingHttpHeaders } from "node:http";
import { PassThrough } from "node:stream";
import type { Provider } from "./providers/registry";
import { loadConfig } from "./hive/load-config";
import { telemetryRecorder } from "./telemetry/recorder";
import { failover } from "./proxy/failover";
import { startHeartbeat } from "./telemetry/heartbeat";
import { loadState, calculateScore } from "./telemetry";
import { sortByPriority } from "./providers";
import { mutateRequest } from "./proxy/mutate-request";
import { routeRequest } from "./proxy/route-request";
import { discoverAndCacheModels } from "./providers/discovery";

export type ProviderUIState = {
  provider: string;
  model: string;
  enabled: boolean;
  stabilityScore: number;
  p95Latency: number;
  recentSuccessRate: number;
};

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
    this.discoveryTimer = setInterval(() => {
      this.triggerBackgroundDiscovery();
    }, 60 * 60 * 1000);
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

    const state = await loadState();
    const providerStates = qualified.map((p) => {
      const providerMetrics = state.metrics.filter(
        (m) => m.provider === p.name,
      );
      return {
        provider: p.name,
        model: p.defaultModel,
        enabled: true,
        stabilityScore: calculateScore(providerMetrics),
      };
    });

    const prioritized = sortByPriority(providerStates);

    const sorted = prioritized
      .map((ps) => qualified.find((p) => p.name === ps.provider))
      .filter((p): p is Provider => p !== undefined);

    const headers: IncomingHttpHeaders = {};
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

  async getProviderStates(): Promise<ProviderUIState[]> {
    const state = await loadState();

    return this.providers.map((p) => {
      const providerMetrics = state.metrics.filter(
        (m) => m.provider === p.name,
      );
      const recentSuccess =
        providerMetrics.length > 0
          ? providerMetrics.filter((m) => m.success).length /
            providerMetrics.length
          : 0;
      const latencies = providerMetrics
        .map((m) => m.ttft)
        .sort((a, b) => a - b);
      const p95 =
        latencies.length > 0
          ? latencies[Math.floor(latencies.length * 0.95)]
          : 0;

      return {
        provider: p.name,
        model: p.defaultModel,
        enabled: true,
        stabilityScore: calculateScore(providerMetrics),
        p95Latency: p95,
        recentSuccessRate: recentSuccess,
      };
    });
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
            `${provider.baseUrl}/v1/chat/completions`,
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
