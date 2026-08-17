/** @public — the web_fetch transport over an injectable fetch. Owns redirect
 * following (same-origin only), byte/char caps, content-type classification,
 * and charset decoding; presentation (HTML→text) lives in the tool. The
 * injectable fetch keeps tests off the network; the default is the global
 * fetch (Node 18+). */

import {
  classifyContentType,
  decoderForCharset,
  FetchError,
  isSameOrigin,
  parseCharset,
  validateFetchUrl,
} from "./fetch-policy.ts";

export type { FetchBodyKind } from "./fetch-policy.ts";
export { FetchError };

export type WebFetchLimits = {
  // Maximum response body size in bytes (a stream that grows past it is cut,
  // not rejected; a declared Content-Length over it rejects immediately).
  maxResponseBytes: number;
  // Maximum decoded body length in characters (truncated past this).
  maxBodyChars: number;
  // Default fetch timeout in milliseconds.
  timeoutMs: number;
  // Maximum number of same-origin redirect hops to follow.
  maxRedirects: number;
};

export type WebFetchBody = {
  kind: "html" | "text" | "markdown";
  content: string;
};

export type WebFetchResult = {
  url: string;
  statusCode: number;
  body: WebFetchBody;
  truncated: boolean;
};

// The fetch seam: the global fetch signature.
export type FetchLike = (
  url: string | URL,
  init?: RequestInit
) => Promise<Response>;

const DEFAULT_LIMITS: WebFetchLimits = {
  maxResponseBytes: 2 * 1024 * 1024,
  maxBodyChars: 60_000,
  timeoutMs: 15_000,
  maxRedirects: 3,
};

export function createHttpFetch(
  fetchImpl: FetchLike = fetch,
  limits: WebFetchLimits = DEFAULT_LIMITS
): (url: string, externalSignal?: AbortSignal) => Promise<WebFetchResult> {
  return (url, externalSignal) =>
    followAndRead(url, externalSignal, fetchImpl, limits);
}

async function followAndRead(
  initialUrl: string,
  externalSignal: AbortSignal | undefined,
  fetchImpl: FetchLike,
  limits: WebFetchLimits
): Promise<WebFetchResult> {
  let currentUrl = validateFetchUrl(initialUrl);
  const timeoutSignal = AbortSignal.timeout(limits.timeoutMs);
  const signal =
    externalSignal !== undefined
      ? AbortSignal.any([externalSignal, timeoutSignal])
      : timeoutSignal;

  let redirects = 0;
  for (;;) {
    if (signal.aborted) {
      throw new FetchError("timeout", "web fetch timed out");
    }
    const response = await requestOnce(currentUrl, fetchImpl, signal);

    if (isRedirectStatus(response.status)) {
      if (redirects >= limits.maxRedirects) {
        await response.body?.cancel();
        throw new FetchError(
          "redirect_blocked",
          `exceeded the maximum of ${limits.maxRedirects} redirects`
        );
      }
      const location = response.headers.get("location");
      if (location === null) {
        await response.body?.cancel();
        throw new FetchError(
          "provider_error",
          `redirect response (HTTP ${response.status}) without a Location header`
        );
      }
      const target = new URL(location, currentUrl);
      if (!isSameOrigin(target, currentUrl)) {
        await response.body?.cancel();
        throw new FetchError(
          "redirect_blocked",
          `cross-origin redirect to ${target.origin} is not followed automatically; retry against that URL directly`
        );
      }
      await response.body?.cancel();
      currentUrl = validateFetchUrl(target.toString());
      redirects += 1;
      continue;
    }

    return readBody(response, currentUrl, signal, limits);
  }
}

async function requestOnce(
  url: URL,
  fetchImpl: FetchLike,
  signal: AbortSignal
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent": "hive-agent/0.1 (web_fetch)",
        // Markdown-first content negotiation (RFC 7763 / acceptmarkdown.com):
        // a server that supports Accept: text/markdown returns the page as
        // clean markdown, skipping the HTML conversion entirely; everything
        // else falls back to html with a q-value.
        accept:
          "text/markdown,text/html;q=0.9,application/xhtml+xml;q=0.9,text/*;q=0.8,application/json;q=0.7",
      },
      signal,
    });
  } catch (error: unknown) {
    throw translateNetworkError(error, signal);
  }
}

async function readBody(
  response: Response,
  finalUrl: URL,
  signal: AbortSignal,
  limits: WebFetchLimits
): Promise<WebFetchResult> {
  const contentType = response.headers.get("content-type");
  const kind = classifyContentType(contentType);
  if (kind === undefined) {
    await response.body?.cancel();
    throw new FetchError(
      "unsupported_content_type",
      `unsupported content type "${contentType ?? "unknown"}"`
    );
  }

  const decoder = decoderForCharset(parseCharset(contentType));
  const { bytes, truncatedByBytes } = await readCapped(
    response,
    signal,
    limits
  );
  const decoded = decoder.decode(bytes);
  const truncatedByChars = decoded.length > limits.maxBodyChars;
  const content = truncatedByChars
    ? decoded.slice(0, limits.maxBodyChars)
    : decoded;

  return {
    url: finalUrl.toString(),
    statusCode: response.status,
    body: { kind, content },
    truncated: truncatedByBytes || truncatedByChars,
  };
}

// Reads the response stream up to maxResponseBytes. A declared Content-Length
// over the cap rejects immediately; a stream that grows past the cap is cut
// short rather than rejected.
async function readCapped(
  response: Response,
  signal: AbortSignal,
  limits: WebFetchLimits
): Promise<{ bytes: Uint8Array; truncatedByBytes: boolean }> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > limits.maxResponseBytes) {
      await response.body?.cancel();
      throw new FetchError(
        "too_large",
        `response exceeds the maximum of ${limits.maxResponseBytes} bytes`
      );
    }
  }

  if (response.body === null) {
    return { bytes: new Uint8Array(0), truncatedByBytes: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncatedByBytes = false;
  for (;;) {
    if (signal.aborted) {
      await reader.cancel();
      throw new FetchError("timeout", "web fetch timed out");
    }
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = limits.maxResponseBytes - total;
    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, remaining));
      truncatedByBytes = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const bytes = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  );
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { bytes, truncatedByBytes };
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function translateNetworkError(error: unknown, signal: AbortSignal): never {
  if (signal.aborted) {
    throw new FetchError("timeout", "web fetch timed out");
  }
  throw new FetchError(
    "network",
    error instanceof Error ? error.message : String(error)
  );
}
