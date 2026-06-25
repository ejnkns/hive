import type { RequestMetric } from "./request-metric"

type WindowConfig = {
  maxEntries: number
  maxAgeMs: number
}

const DEFAULT_WINDOW: WindowConfig = {
  maxEntries: 100,
  maxAgeMs: 24 * 60 * 60 * 1000,
}

export function applyWindow(
  metrics: RequestMetric[],
  config: WindowConfig = DEFAULT_WINDOW,
): RequestMetric[] {
  const now = Date.now()
  const cutoff = now - config.maxAgeMs

  const recent = metrics.filter((m) => m.timestamp >= cutoff)
  return recent.slice(-config.maxEntries)
}
