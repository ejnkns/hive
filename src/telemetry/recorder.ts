import type { RequestMetrics } from "./sliding-window";
import { loadState, saveState } from "./persistence";
import { slidingWindow } from "./sliding-window";
import { calculateScore } from "./calculate-score";

const FLUSH_INTERVAL_MS = 12_000;

export class TelemetryRecorder {
  private buffer: RequestMetrics[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  recordMetric(metric: RequestMetrics): void {
    this.buffer.push(metric);
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const state = await loadState();
    const combined = [...state.metrics, ...this.buffer];

    const providerMap = new Map<string, RequestMetrics[]>();
    for (const m of combined) {
      const key = `${m.provider}:${m.model}`;
      if (!providerMap.has(key)) providerMap.set(key, []);
      providerMap.get(key)!.push(m);
    }

    const retained: RequestMetrics[] = [];
    for (const [, ms] of providerMap) {
      retained.push(...slidingWindow(ms));
    }

    state.metrics = retained;

    const providerKeys = [...providerMap.keys()];
    state.providerStates = providerKeys.map((key) => {
      const [provider, model] = key.split(":");
      const metrics = providerMap.get(key)!;
      return {
        provider,
        model,
        enabled: true,
        stabilityScore: calculateScore(metrics),
      };
    });

    await saveState(state);
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
