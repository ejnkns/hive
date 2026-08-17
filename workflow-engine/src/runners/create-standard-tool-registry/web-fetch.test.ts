// The model-facing web_fetch tool: URL in, compact markdown text out. The
// executor composes the transport (http-fetch) with the converter
// (html-to-text) and caps the final output; the fetch seam keeps tests off
// the network.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCall, ToolContext } from "../tool-types.ts";
import { createWebFetchExecutor } from "./web-fetch.ts";

function htmlResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {}
) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

const call: ToolCall = { id: "c1", name: "web_fetch", arguments: "" };

const ctx: ToolContext = { workspacePath: "/tmp" };

describe("web_fetch tool", () => {
  it("fetches a URL and returns the converted markdown text", async () => {
    const execute = createWebFetchExecutor(
      async () =>
        htmlResponse(
          "<html><head><title>Docs</title></head><body><nav>menu</nav><h1>Hive</h1><p>Great docs.</p></body></html>"
        ),
      { maxOutputChars: 1_000 }
    );
    const result = await execute(
      { ...call, arguments: JSON.stringify({ url: "https://example.com" }) },
      ctx
    );
    assert.equal(result.isError, false);
    assert.ok(
      result.content.includes("Fetched https://example.com"),
      result.content
    );
    assert.ok(result.content.includes("(HTTP 200)"), result.content);
    assert.ok(result.content.includes("# Hive"), result.content);
    assert.ok(result.content.includes("Great docs."), result.content);
    assert.ok(!result.content.includes("menu"), "chrome is stripped");
  });

  it("passes text bodies through", async () => {
    const execute = createWebFetchExecutor(
      async () =>
        new Response("raw text body", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      { maxOutputChars: 1_000 }
    );
    const result = await execute(
      { ...call, arguments: JSON.stringify({ url: "https://example.com/x" }) },
      ctx
    );
    assert.equal(result.isError, false);
    assert.ok(result.content.includes("raw text body"));
  });

  it("reports non-2xx statuses as errors", async () => {
    const execute = createWebFetchExecutor(
      async () => htmlResponse("not found", 404),
      {}
    );
    const result = await execute(
      {
        ...call,
        arguments: JSON.stringify({ url: "https://example.com/nope" }),
      },
      ctx
    );
    assert.equal(result.isError, true);
    assert.ok(result.content.includes("HTTP 404"));
  });

  it("reports transport errors as errors", async () => {
    const execute = createWebFetchExecutor(async () => {
      throw new Error("connection refused");
    }, {});
    const result = await execute(
      {
        ...call,
        arguments: JSON.stringify({ url: "https://example.com/down" }),
      },
      ctx
    );
    assert.equal(result.isError, true);
    assert.ok(result.content.includes("connection refused"));
  });

  it("rejects a blank url", async () => {
    const execute = createWebFetchExecutor(async () => htmlResponse(""), {});
    const result = await execute(
      { ...call, arguments: JSON.stringify({ url: "   " }) },
      ctx
    );
    assert.equal(result.isError, true);
  });

  it("caps the final output and appends the truncation footer", async () => {
    const execute = createWebFetchExecutor(
      async () => htmlResponse(`<p>${"word ".repeat(2_000)}</p>`),
      { maxOutputChars: 300 }
    );
    const result = await execute(
      {
        ...call,
        arguments: JSON.stringify({ url: "https://example.com/long" }),
      },
      ctx
    );
    assert.equal(result.isError, false);
    assert.ok(result.content.length <= 320, result.content.length.toString());
    assert.ok(result.content.includes("Content truncated"), result.content);
  });
});
