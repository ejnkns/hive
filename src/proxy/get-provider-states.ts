import { loadCache, type SubScores } from "../telemetry";
import { getCoreState } from "./core-context";

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
  const state = getCoreState();
  const cache = await loadCache();
  return cache.scores.map((s) => ({
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
}
