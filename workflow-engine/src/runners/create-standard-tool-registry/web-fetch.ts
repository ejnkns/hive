/** The model-facing `web_fetch` tool: retrieve the content of a specific
 * HTTP(S) URL and return it as compact markdown text. The transport owns
 * retrieval (same-origin redirects, byte/char caps, charset decode); the
 * converter owns token minimization (chrome stripped, whitespace collapsed);
 * this module owns the schema, the model-facing text shape, and the output
 * cap. */

import { htmlToText } from "../../web/html-to-text.ts";
import {
  createHttpFetch,
  FetchError,
  type FetchLike,
  type WebFetchLimits,
} from "../../web/http-fetch.ts";
import type { ToolDefinition, ToolExecutor } from "../tool-types.ts";

export const definition: ToolDefinition = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch the content of a specific HTTP(S) URL and return it as compact markdown text (chrome stripped, whitespace collapsed, truncated). Use it to read documentation, APIs, or pages a search result points to. Cite the URL as a markdown link when you use its content.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The HTTP(S) URL to fetch.",
        },
      },
      required: ["url"],
    },
  },
};

// The model-facing output cap. Model-dependent in the long run (the budget is
// the model's context window — see the plan's follow-up note); a sane default
// for now, overridable per executor.
const DEFAULT_MAX_OUTPUT_CHARS = 12_000;

const TRUNCATION_FOOTER =
  "\n\n(Content truncated. Fetch a more specific URL or section for the full text.)";

export type WebFetchExecutorOptions = {
  maxOutputChars?: number;
  limits?: WebFetchLimits;
};

// The executor factory, with the fetch seam injectable for tests. The
// registry binds the default (global fetch, default caps).
export function createWebFetchExecutor(
  fetchImpl: FetchLike = fetch,
  options: WebFetchExecutorOptions = {}
): ToolExecutor {
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const fetchWeb = createHttpFetch(fetchImpl, options.limits);
  return async (call, ctx) => {
    const args = safeParseArgs(call.arguments);
    if (args.url === undefined || args.url.trim() === "") {
      return {
        toolCallId: call.id,
        content: "url must be a non-empty string",
        isError: true,
      };
    }
    try {
      const result = await fetchWeb(args.url, ctx.signal);
      if (result.statusCode >= 400) {
        return {
          toolCallId: call.id,
          content: `HTTP ${result.statusCode} fetching ${result.url}`,
          isError: true,
        };
      }
      const rendered =
        result.body.kind === "html"
          ? htmlToText(result.body.content, {
              maxInputChars: result.body.content.length,
            })
          : { text: result.body.content, truncated: false };
      const header = `Fetched ${result.url} (HTTP ${result.statusCode})\n\n`;
      const truncated = result.truncated || rendered.truncated;
      const prefix = `${header}${rendered.text}`;
      const full = truncated ? `${prefix}${TRUNCATION_FOOTER}` : prefix;
      return {
        toolCallId: call.id,
        content: capOutput(full, maxOutputChars, truncated),
        isError: false,
      };
    } catch (error) {
      return {
        toolCallId: call.id,
        content: error instanceof FetchError ? error.message : String(error),
        isError: true,
      };
    }
  };
}

// Bounds the complete returned string; a cut body gets the same
// fetch-something-narrower notice as transport-side truncation.
function capOutput(
  content: string,
  maxOutputChars: number,
  truncated: boolean
): string {
  if (content.length <= maxOutputChars) return content;
  if (maxOutputChars < TRUNCATION_FOOTER.length) {
    return content.slice(0, maxOutputChars);
  }
  if (truncated) {
    const bodyCap = maxOutputChars - TRUNCATION_FOOTER.length;
    return `${content.slice(0, bodyCap)}${TRUNCATION_FOOTER}`;
  }
  return `${content.slice(0, maxOutputChars - TRUNCATION_FOOTER.length)}${TRUNCATION_FOOTER}`;
}

function safeParseArgs(argumentsJson: string): { url?: string } {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (parsed !== null && typeof parsed === "object") {
      const url = (parsed as Record<string, unknown>).url;
      if (typeof url === "string") return { url };
    }
  } catch {
    // fall through to the blank-url error
  }
  return {};
}

// The registry binds this fixed default executor.
export const execute: ToolExecutor = createWebFetchExecutor();
