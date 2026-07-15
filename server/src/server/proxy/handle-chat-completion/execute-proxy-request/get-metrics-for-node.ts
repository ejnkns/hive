import type { loadCache, RequestMetric } from "telemetry";
import { applySlidingWindow } from "telemetry";

export function getMetricsForNode(
  compoundKey: string,
  cache: Awaited<ReturnType<typeof loadCache>>
): RequestMetric[] {
  const all = cache.metrics.filter(
    (m) => `${m.provider}:${m.model}` === compoundKey
  );
  return applySlidingWindow(all);
}
