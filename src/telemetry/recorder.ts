import { logger } from "../shared/logger";
import { applySlidingWindow } from "./apply-sliding-window";
import { loadCache, type ModelScore, saveCache } from "./cache";
import { calculateNodeScore } from "./calculate-node-score";
import { computeDerivedMetrics } from "./derived-metrics";
import type { RequestMetric } from "./request-metric";

const FLUSH_INTERVAL_MS = 12_000;

export function createTelemetryRecorder() {
  let buffer: RequestMetric[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();

  function onChange(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function notify() {
    for (const cb of listeners) {
      try {
        cb();
      } catch {
        // ignore
      }
    }
  }

  function recordMetric(metric: RequestMetric): void {
    buffer.push(metric);
    notify();
  }

  function start(): void {
    if (flushTimer) {
      logger.debug("recorder: already started");
      return;
    }
    logger.debug("recorder: started");
    flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  }

  async function flush(): Promise<void> {
    if (buffer.length === 0) {
      logger.debug("recorder: flush — buffer empty");
      return;
    }
    const count = buffer.length;

    const cache = await loadCache();
    const combined = [...cache.metrics, ...buffer];

    const providerMap = new Map<string, RequestMetric[]>();
    for (const m of combined) {
      const key = `${m.provider}:${m.model}`;
      if (!providerMap.has(key)) providerMap.set(key, []);
      providerMap.get(key)?.push(m);
    }

    const retained: RequestMetric[] = [];
    const scores: ModelScore[] = [];

    for (const [key, ms] of providerMap) {
      const windowed = applySlidingWindow(ms);
      retained.push(...windowed);

      const [provider, model] = key.split(":");
      const node = { providerName: provider, modelName: model };
      const result = calculateNodeScore(node, windowed);
      scores.push({
        provider,
        model,
        score: result.composite,
        subscores: result.subscores,
        derived: computeDerivedMetrics(windowed),
        updatedAt: Date.now(),
      });
    }

    await saveCache({ metrics: retained, scores });
    buffer = [];
    logger.debug(`recorder: flush — saved ${String(count)} metrics to cache`);
    notify();
  }

  function getPendingCount(): number {
    return buffer.length;
  }

  function stop(): void {
    if (flushTimer) {
      logger.debug("recorder: stopping");
      clearInterval(flushTimer);
      flushTimer = null;
    }
  }

  return { onChange, recordMetric, start, flush, getPendingCount, stop };
}

export const telemetryRecorder = createTelemetryRecorder();
