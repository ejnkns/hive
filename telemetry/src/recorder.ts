import { logger } from "shared/logger";
import { applySlidingWindow } from "./apply-sliding-window";
import { loadCache, type ModelScore, saveCache } from "./cache";
import { calculateNodeScore } from "./calculate-node-score";
import { computeDerivedMetrics } from "./derived-metrics";
import type { RequestMetric } from "./request-metric";

const FLUSH_DEBOUNCE_MS = 1_000;

/** @package */
export class TelemetryRecorder {
  private buffer: RequestMetric[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
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

  private scheduleFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  recordMetric(metric: RequestMetric): void {
    this.buffer.push(metric);
    this.scheduleFlush();
    this.notify();
  }

  start(): void {
    if (this.flushTimer) {
      logger.debug("recorder: already started");
      return;
    }
    logger.debug("recorder: started");
  }

  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
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
    this.buffer = [];
    logger.debug(
      `recorder: flush — saved ${String(count)} metrics, ${String(scores.length)} scores`
    );
    for (const s of scores) {
      logger.debug(
        `recorder: score — ${s.provider}:${s.model} reqCount=${s.derived.requestCount} stability=${s.score.toFixed(1)}`
      );
    }
    logger.debug(`recorder: flush — saved ${String(count)} metrics to cache`);
    this.notify();
  }

  getPendingCount(): number {
    return this.buffer.length;
  }

  stop(): void {
    logger.debug("recorder: stopping");
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

export const telemetryRecorder = new TelemetryRecorder();
