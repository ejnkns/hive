import type { RequestMetrics } from './sliding-window.js'
import { slidingWindow } from './sliding-window.js'

const WEIGHTS = {
  p95Latency: 0.3,
  jitter: 0.3,
  spikeRate: 0.2,
  successRate: 0.2,
} as const

export function calculateScore(metrics: RequestMetrics[]): number {
  const window = slidingWindow(metrics)
  if (window.length === 0) return 50

  const latencies = window.map((m) => m.ttft)
  const sorted = [...latencies].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const variance = latencies.reduce((a, b) => a + (b - mean) ** 2, 0) / latencies.length
  const jitter = Math.sqrt(variance)
  const spikes = window.filter((m) => m.ttft > 4000).length / window.length
  const successRate = window.filter((m) => m.success).length / window.length

  const latencyScore = Math.max(0, 100 - p95 / 30)
  const jitterScore = Math.max(0, 100 - jitter / 40)
  const spikeScore = (1 - spikes) * 100
  const successScore = successRate * 100

  return Math.round(
    latencyScore * WEIGHTS.p95Latency +
      jitterScore * WEIGHTS.jitter +
      spikeScore * WEIGHTS.spikeRate +
      successScore * WEIGHTS.successRate,
  )
}
