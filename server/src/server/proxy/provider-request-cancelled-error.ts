export class ProviderRequestCancelledError extends Error {
  constructor(cause?: unknown) {
    super("Provider request cancelled", { cause });
    this.name = "ProviderRequestCancelledError";
  }
}

export function isProviderRequestCancelledError(
  error: unknown
): error is ProviderRequestCancelledError {
  return error instanceof ProviderRequestCancelledError;
}
