import { logger } from "shared/logger";
import { loadCache, type SubScores } from "telemetry";
import { getServerState } from "./server-state";

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

export async function getProviderStates(): Promise<ProviderState[]> {
  const state = getServerState();
  const cache = await loadCache();
  logger.debug(
    `getProviderStates: loaded ${cache.scores.length} score entries from cache`
  );
  const result = cache.scores.map((s) => ({
    provider: s.provider,
    model: s.model,
    enabled: !state.isProviderDisabled(s.provider),
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
  logger.debug(
    `getProviderStates: returning ${result.length} states: ${result.map((s) => `${s.provider}:${s.model}(${s.requestCount}c)`).join(", ")}`
  );
  return result;
}
