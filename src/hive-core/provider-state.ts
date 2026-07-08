import type { SubScores } from "../telemetry";

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
