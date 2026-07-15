import { ERROR_PENALTIES } from "../error-penalties";
import type { RequestMetric } from "../request-metric";

const DECAY_HALF_LIFE_MS = 30 * 60 * 1000;

function getFailureWeight(m: RequestMetric): number {
  if (m.success) return 0;
  if (m.errorType) {
    return ERROR_PENALTIES[m.errorType] ?? 1.0;
  }
  return 1.0;
}

export function computeReliabilityScore(metrics: RequestMetric[]): number {
  const now = Date.now();
  let totalPenaltyPoints = 0;
  let normalizer = 0;

  for (const m of metrics) {
    const age = now - m.timestamp;
    const decay = Math.exp((-age * Math.LN2) / DECAY_HALF_LIFE_MS);
    const severity = getFailureWeight(m);

    totalPenaltyPoints += severity * decay;
    normalizer += Math.max(severity, 1.0) * decay;
  }

  const penaltyRate = normalizer > 0 ? totalPenaltyPoints / normalizer : 0;
  return Math.max(0, 100 - penaltyRate * 100);
}
