export const ERROR_PENALTIES = {
  "rate-limited": 0.5,
  "server-error": 1.0,
  "auth-error": 2.5,
  timeout: 1.0,
  "network-error": 1.0,
  "invalid-request": 0.0,
} as const;
