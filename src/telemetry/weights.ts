export const SUB_WEIGHTS = {
  ttftScore: 0.25,
  throughputScore: 0.30,
  jitterScore: 0.15,
  reliabilityScore: 0.30,
  thinkingScore: 0.10,
  spikeScore: 0,
  qualityScore: 0,
} as const

export const ERROR_PENALTIES = {
  "rate-limited": 0.3,
  "server-error": 1.0,
  "auth-error": 0.0,
  timeout: 1.0,
  "network-error": 1.0,
  "invalid-request": 0.0,
} as const
