import type { IncomingHttpHeaders } from "node:http";

export function filterHeaders(
  incomingHeaders: Record<string, string | string[] | undefined>
): IncomingHttpHeaders {
  return Object.fromEntries(
    Object.entries(incomingHeaders).filter(
      ([key]) =>
        !["authorization", "host", "content-length", "content-type"].includes(
          key.toLowerCase()
        )
    )
  );
}
