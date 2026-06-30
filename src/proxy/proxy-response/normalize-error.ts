export type NormalizedErrorType = "unsupported-feature" | "auth-error" | "rate-limit" | "server-error" | "unknown";

export type NormalizedError = {
  type: NormalizedErrorType;
  message: string;
  retryable: boolean;
};

export function normalizeError(status: number, body: unknown): NormalizedError {
  const bodyStr = (typeof body === "string" ? body : JSON.stringify(body ?? "")).toLowerCase();

  if (status === 401 || status === 403 || bodyStr.includes("api key") || bodyStr.includes("unauthorized")) {
    return {
      type: "auth-error",
      message: "Upstream authentication failed",
      retryable: false,
    };
  }

  if (
    status === 400 &&
    (bodyStr.includes("unsupported") ||
      bodyStr.includes("invalid parameter") ||
      bodyStr.includes("model does not support") ||
      bodyStr.includes("unknown parameter"))
  ) {
    return {
      type: "unsupported-feature",
      message: "Upstream node lacks requested feature",
      retryable: false,
    };
  }

  if (status === 429) {
    return {
      type: "rate-limit",
      message: "Upstream rate limit exceeded",
      retryable: true,
    };
  }

  if (status >= 500) {
    return {
      type: "server-error",
      message: "Upstream provider internal error",
      retryable: true,
    };
  }

  return {
    type: "unknown",
    message: "An unclassified error occurred",
    retryable: false,
  };
}
