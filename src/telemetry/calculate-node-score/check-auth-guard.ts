import type { RequestMetric } from "../request-metric";

export type AuthGuardResult = { passed: true } | { passed: false; score: 0 };

export function checkAuthGuard(metrics: RequestMetric[]): AuthGuardResult {
  const totalRequests = metrics.length;
  let previousWasAuthError = false;
  let consecutiveAuthErrors = 0;
  let totalErrors = 0;

  const chronologicalMetrics = [...metrics].sort(
    (a, b) => b.timestamp - a.timestamp
  );

  for (const m of chronologicalMetrics) {
    if (!m.success) {
      totalErrors++;
      if (
        m.statusCode === 401 ||
        m.statusCode === 403 ||
        m.errorType === "auth-error"
      ) {
        if (previousWasAuthError) {
          consecutiveAuthErrors++;
        } else {
          previousWasAuthError = true;
          consecutiveAuthErrors = 1;
        }
      }
    } else {
      break;
    }
  }

  if (
    consecutiveAuthErrors >= 2 ||
    (totalRequests > 0 && totalErrors === totalRequests)
  ) {
    return { passed: false, score: 0 };
  }

  return { passed: true };
}
