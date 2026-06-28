import type { RequestMetric } from "./request-metric";
import { loadCache, saveCache, type ModelScore } from "./persist";
import { applyWindow } from "./window";
import { calculateNodeScore } from "./calculate-node-score";
import { computeDerivedMetrics } from "./derived-metrics";
import { logger } from "../hive/shared/logger";

const FLUSH_INTERVAL_MS = 12_000;

export class TelemetryRecorder {
  private buffer: RequestMetric[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        // ignore
      }
    }
  }

  recordMetric(metric: RequestMetric): void {
    this.buffer.push(metric);
    this.notify();
  }

  start(): void {
    if (this.flushTimer) {
      logger.debug("recorder: already started");
      return;
    }
    logger.debug("recorder: started");
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      logger.debug("recorder: flush — buffer empty");
      return;
    }
    const count = this.buffer.length;

    const cache = await loadCache();
    const combined = [...cache.metrics, ...this.buffer];

    const providerMap = new Map<string, RequestMetric[]>();
    for (const m of combined) {
      const key = `${m.provider}:${m.model}`;
      if (!providerMap.has(key)) providerMap.set(key, []);
      providerMap.get(key)?.push(m);
    }

    const retained: RequestMetric[] = [];
    const scores: ModelScore[] = [];

    for (const [key, ms] of providerMap) {
      const windowed = applyWindow(ms);
      retained.push(...windowed);

      const [provider, model] = key.split(":");
      scores.push({
        provider,
        model,
        score: calculateNodeScore(
          { providerName: provider, modelName: model },
          windowed
        ),
        derived: computeDerivedMetrics(windowed),
        updatedAt: Date.now(),
      });
    }

    await saveCache({ metrics: retained, scores });
    this.buffer = [];
    logger.debug(`recorder: flush — saved ${String(count)} metrics to cache`);
    this.notify();
  }

  getPendingCount(): number {
    return this.buffer.length;
  }

  stop(): void {
    if (this.flushTimer) {
      logger.debug("recorder: stopping");
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

export const telemetryRecorder = new TelemetryRecorder();
