import type { RequestMetric } from "./request-metric";
import { loadCache, saveCache, type ModelScore } from "./persist";
import { applyWindow } from "./window";
import { calculateNodeScore } from "./score";
import { computeDerivedMetrics } from "./derived-metrics";

const FLUSH_INTERVAL_MS = 12_000;

export class TelemetryRecorder {
  private buffer: RequestMetric[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  recordMetric(metric: RequestMetric): void {
    this.buffer.push(metric);
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const cache = await loadCache();
    const combined = [...cache.metrics, ...this.buffer];

    const providerMap = new Map<string, RequestMetric[]>();
    for (const m of combined) {
      const key = `${m.provider}:${m.model}`;
      if (!providerMap.has(key)) providerMap.set(key, []);
      providerMap.get(key)!.push(m);
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
  }

  getPendingCount(): number {
    return this.buffer.length;
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

export const telemetryRecorder = new TelemetryRecorder();
