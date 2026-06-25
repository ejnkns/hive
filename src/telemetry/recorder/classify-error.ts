import type { ErrorType } from "../request-metric";

export function classifyError(
  statusCode: number,
  errorHint?: string
): ErrorType {
  if (statusCode === 0) {
    if (errorHint === "TIMEOUT") return "timeout";
    if (errorHint === "NETWORK_ERROR") return "network-error";
    return "network-error";
  }

  if (statusCode >= 200 && statusCode < 400) return null;

  if (statusCode === 401 || statusCode === 403) return "auth-error";
  if (statusCode === 429) return "rate-limited";
  if (statusCode === 400 || statusCode === 422) return "invalid-request";
  if (statusCode >= 400 && statusCode < 500) return "invalid-request";
  if (statusCode >= 500) return "server-error";

  return "network-error";
}
