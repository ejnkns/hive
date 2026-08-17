/** @public — URL and content-type policy for the web_fetch tool (pure,
 * network-free). Mirrors deepseek-harness's web-fetch-http policy: http(s)
 * only, no embedded credentials, bounded length, same-origin redirects only.
 *
 * SSRF / private-network blocking is deliberately deferred (as in
 * web-fetch-http): do not enable web_fetch where it can reach sensitive
 * internal targets. Same-origin redirects are the compensating control — a
 * cross-origin redirect refuses so each new origin requires a fresh tool call. */

export type FetchErrorCode =
  | "invalid_url"
  | "blocked_url"
  | "unsupported_content_type"
  | "unsupported_charset"
  | "too_large"
  | "redirect_blocked"
  | "provider_error"
  | "timeout"
  | "network";

export class FetchError extends Error {
  readonly code: FetchErrorCode;

  constructor(code: FetchErrorCode, message: string) {
    super(message);
    this.name = "FetchError";
    this.code = code;
  }
}

export type FetchBodyKind = "html" | "text" | "markdown";

export const MAX_URL_LENGTH = 2_000;

// Validates a request URL before any network access: http(s) only, no
// embedded credentials, bounded length. Returns the parsed URL.
export function validateFetchUrl(
  input: string,
  maxLength: number = MAX_URL_LENGTH
): URL {
  if (input.length > maxLength) {
    throw new FetchError(
      "invalid_url",
      `URL exceeds the maximum length of ${maxLength}`
    );
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FetchError("invalid_url", `invalid URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError(
      "blocked_url",
      `unsupported URL scheme "${url.protocol}" (only http and https are allowed)`
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new FetchError("blocked_url", "credentials in URLs are not allowed");
  }
  return url;
}

// Same-origin when scheme, hostname, and port match. A redirect that crosses
// origins is refused so each new origin requires a fresh tool call.
export function isSameOrigin(a: URL, b: URL): boolean {
  return (
    a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
  );
}

// Classify a response Content-Type into a decodable body kind, or undefined
// for an unsupported (binary) type.
export function classifyContentType(
  contentType: string | null
): FetchBodyKind | undefined {
  const mime = (contentType ?? "").replace(/;.*$/s, "").trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  // Markdown (RFC 7763) is its own kind: already agent-ready, passes through
  // without HTML conversion (the Accept: text/markdown negotiation result).
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  if (mime.startsWith("text/")) return "text";
  if (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  ) {
    return "text";
  }
  return undefined;
}

// The charset parameter of a Content-Type, lower-cased, or undefined when
// absent (the decoder defaults to utf-8).
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? "");
  return match?.[1]?.trim().toLowerCase();
}

// Build a TextDecoder for the declared charset (utf-8 when absent); a label
// TextDecoder does not recognize fails loudly rather than returning mojibake.
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder("utf-8");
  try {
    return new TextDecoder(charset);
  } catch {
    throw new FetchError(
      "unsupported_charset",
      `unsupported charset "${charset}"`
    );
  }
}

// ── Link header (RFC 8288) ─────────────────────────────────────────────

// The first target of a `Link` header advertising a markdown alternate
// (`rel="alternate"` with `type="text/markdown"`, optionally with a
// `variant` parameter per RFC 7764), or undefined. A page that advertises its
// .md representation this way — without negotiating on `Accept` — is served
// directly to the agent instead of converting its HTML.
export function markdownAlternateFromLink(
  linkHeader: string | null
): string | undefined {
  if (linkHeader === null) return undefined;
  for (const link of parseLinkHeader(linkHeader)) {
    const rel = (link.params.get("rel") ?? "").toLowerCase();
    const type = (link.params.get("type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    if (
      rel.split(/\s+/).includes("alternate") &&
      (type === "text/markdown" || type === "text/x-markdown")
    ) {
      return link.target;
    }
  }
  return undefined;
}

type LinkHeaderLink = {
  target: string;
  params: Map<string, string>;
};

// Splits a Link header into its links on commas that are not inside the
// angle-bracketed target or a quoted parameter value.
function parseLinkHeader(header: string): LinkHeaderLink[] {
  const links: LinkHeaderLink[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = "";
  const flush = (): void => {
    const trimmed = current.trim();
    current = "";
    const parsed = parseLink(trimmed);
    if (parsed !== undefined) links.push(parsed);
  };
  for (const char of header) {
    if (quote !== undefined) {
      current += char;
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      current += char;
      quote = char;
    } else if (char === "<") {
      depth += 1;
      current += char;
    } else if (char === ">") {
      depth -= 1;
      current += char;
    } else if (char === "," && depth === 0) {
      flush();
    } else {
      current += char;
    }
  }
  flush();
  return links;
}

function parseLink(link: string): LinkHeaderLink | undefined {
  const open = link.indexOf("<");
  const close = link.indexOf(">", open + 1);
  if (open === -1 || close === -1) return undefined;
  const target = link.slice(open + 1, close);
  const params = new Map<string, string>();
  for (const part of splitLinkParams(link.slice(close + 1))) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let value = part.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== "") params.set(key, value);
  }
  return { target, params };
}

// Splits a link's parameter section on `;`, respecting quoted values (a
// `type="text/markdown; variant=CommonMark"` value keeps its inner `;`).
function splitLinkParams(rest: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const char of rest) {
    if (quote !== undefined) {
      current += char;
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      current += char;
      quote = char;
    } else if (char === ";") {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim() !== "") parts.push(current);
  return parts;
}
