// The web_fetch transport: same-origin redirect following, byte/char caps,
// content-type classification, charset decode — over an injectable fetch so
// tests never touch the network.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHttpFetch,
  FetchError,
  type FetchLike,
  type WebFetchLimits,
} from "../web/http-fetch.ts";

const LIMITS: WebFetchLimits = {
  maxResponseBytes: 1024,
  maxBodyChars: 200,
  timeoutMs: 5_000,
  maxRedirects: 3,
};

function htmlResponse(body: string, extraHeaders: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...extraHeaders },
  });
}

describe("createHttpFetch", () => {
  it("fetches and classifies an HTML body", async () => {
    const fetchImpl: FetchLike = async () =>
      htmlResponse("<html><body><h1>Docs</h1></body></html>");
    const fetchWeb = createHttpFetch(fetchImpl, LIMITS);
    const result = await fetchWeb("https://example.com/docs");
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.kind, "html");
    assert.ok(result.body.content.includes("<h1>Docs</h1>"));
    assert.equal(result.truncated, false);
  });

  it("passes text bodies through", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("plain text", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    const fetchWeb = createHttpFetch(fetchImpl, LIMITS);
    const result = await fetchWeb("https://example.com/note.txt");
    assert.equal(result.body.kind, "text");
    assert.equal(result.body.content, "plain text");
  });

  it("rejects unsupported content types", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("pdf", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    const fetchWeb = createHttpFetch(fetchImpl, LIMITS);
    await assert.rejects(
      () => fetchWeb("https://example.com/doc.pdf"),
      (error: unknown) =>
        error instanceof FetchError && error.code === "unsupported_content_type"
    );
  });

  it("follows same-origin redirects and refuses cross-origin ones", async () => {
    const fetchImpl: FetchLike = async (url) => {
      const u = String(url);
      if (u === "https://example.com/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "/moved" },
        });
      }
      if (u === "https://example.com/moved") {
        return htmlResponse("<p>Landed.</p>");
      }
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.com/steal" },
      });
    };
    const fetchWeb = createHttpFetch(fetchImpl, LIMITS);
    const result = await fetchWeb("https://example.com/start");
    assert.equal(result.body.kind, "html");
    assert.ok(result.body.content.includes("Landed"));
    assert.equal(result.url, "https://example.com/moved");

    await assert.rejects(
      () => fetchWeb("https://example.com/cross"),
      (error: unknown) =>
        error instanceof FetchError && error.code === "redirect_blocked"
    );
  });

  it("rejects a declared content-length over the byte cap", async () => {
    const fetchImpl: FetchLike = async () =>
      htmlResponse("<p>big</p>", { "content-length": "999999" });
    const fetchWeb = createHttpFetch(fetchImpl, LIMITS);
    await assert.rejects(
      () => fetchWeb("https://example.com/big"),
      (error: unknown) =>
        error instanceof FetchError && error.code === "too_large"
    );
  });

  it("cuts a stream that grows past the cap and flags truncation", async () => {
    const body = "x".repeat(2_000);
    const fetchImpl: FetchLike = async () => htmlResponse(body);
    const fetchWeb = createHttpFetch(fetchImpl, LIMITS);
    const result = await fetchWeb("https://example.com/long");
    assert.equal(result.truncated, true);
    assert.ok(result.body.content.length <= LIMITS.maxBodyChars);
  });

  it("requests markdown first via Accept: text/markdown, falling back to html", async () => {
    let sentAccept = "";
    const fetchImpl: FetchLike = async (_url, init) => {
      sentAccept = new Headers(init?.headers).get("accept") ?? "";
      return htmlResponse("<p>docs</p>");
    };
    const fetchWeb = createHttpFetch(fetchImpl, LIMITS);
    await fetchWeb("https://example.com/docs");
    // Markdown preferred (RFC 7763 content negotiation), HTML as the fallback.
    assert.ok(
      sentAccept.includes("text/markdown"),
      `expected text/markdown in Accept, got ${JSON.stringify(sentAccept)}`
    );
    assert.ok(
      sentAccept.includes("text/html;q="),
      `expected an html q-value fallback, got ${JSON.stringify(sentAccept)}`
    );
  });

  it("classifies a text/markdown response as markdown (no html conversion)", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response("# Title\n\nSome **markdown** body.", {
        status: 200,
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    const fetchWeb = createHttpFetch(fetchImpl, LIMITS);
    const result = await fetchWeb("https://example.com/page");
    assert.equal(result.body.kind, "markdown");
    assert.ok(result.body.content.includes("**markdown**"));
  });

  it("rejects invalid URLs before any network access", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return htmlResponse("");
    };
    const fetchWeb = createHttpFetch(fetchImpl, LIMITS);
    await assert.rejects(
      () => fetchWeb("file:///etc/passwd"),
      (error: unknown) =>
        error instanceof FetchError && error.code === "blocked_url"
    );
    assert.equal(called, false, "no request for a blocked URL");
  });
});
