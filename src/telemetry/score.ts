import type { RequestMetric } from "./request-metric"
import { applyWindow } from "./window"
import { SUB_WEIGHTS } from "./weights"
import { ttftScore } from "./score/ttft-score"
import { throughputScore } from "./score/throughput-score"
import { jitterScore } from "./score/jitter-score"
import { reliabilityScore } from "./score/reliability-score"
import { thinkingScore } from "./score/thinking-score"
import { spikeScore } from "./score/spike-score"
import { qualityScore } from "./score/quality-score"

type ScoreFn = (metrics: RequestMetric[]) => number
type ScoredSubScore = { name: string; fn: ScoreFn; weight: number }

const ALL_SUB_SCORES: ScoredSubScore[] = [
  { name: "ttftScore", fn: ttftScore, weight: SUB_WEIGHTS.ttftScore },
  { name: "throughputScore", fn: throughputScore, weight: SUB_WEIGHTS.throughputScore },
  { name: "jitterScore", fn: jitterScore, weight: SUB_WEIGHTS.jitterScore },
  { name: "reliabilityScore", fn: reliabilityScore, weight: SUB_WEIGHTS.reliabilityScore },
  { name: "thinkingScore", fn: thinkingScore, weight: SUB_WEIGHTS.thinkingScore },
  { name: "spikeScore", fn: spikeScore, weight: SUB_WEIGHTS.spikeScore },
  { name: "qualityScore", fn: qualityScore, weight: SUB_WEIGHTS.qualityScore },
]

export function calculateScore(metrics: RequestMetric[]): number {
  const window = applyWindow(metrics)
  if (window.length === 0) return 50

  const hasThinking = window.some((m) => m.thinkingTime !== null)

  const active = ALL_SUB_SCORES.filter((s) => {
    if (s.name === "thinkingScore" && !hasThinking) return false
    return s.weight > 0
  })

  const totalWeight = active.reduce((sum, s) => sum + s.weight, 0)
  if (totalWeight === 0) return 50

  let score = 0
  for (const sub of active) {
    const subValue = sub.fn(window)
    score += subValue * (sub.weight / totalWeight)
  }

  return Math.round(score)
}
