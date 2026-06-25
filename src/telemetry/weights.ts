export const SUB_WEIGHTS = {
  ttftScore: 0.25,
  throughputScore: 0.3,
  jitterScore: 0.15,
  reliabilityScore: 0.3,
  thinkingScore: 0.1,
  spikeScore: 0,
  qualityScore: 0,
} as const;

export const ERROR_PENALTIES = {
  "rate-limited": 0.3,
  "server-error": 1.0,
  "auth-error": 1.0,
  timeout: 1.0,
  "network-error": 1.0,
  "invalid-request": 0.0,
} as const;
