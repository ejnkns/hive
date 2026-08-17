// The pure, network-free half of web_fetch: URL validation, same-origin
// redirect policy, content-type classification, and charset resolution —
// mirroring deepseek-harness's web-fetch-http policy (which in turn defers
// SSRF/private-network blocking: "do not enable where it can reach sensitive
// internal targets").

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyContentType,
  isSameOrigin,
  markdownAlternateFromLink,
  parseCharset,
  validateFetchUrl,
} from "../web/fetch-policy.ts";

describe("validateFetchUrl", () => {
  it("accepts http(s) URLs", () => {
    assert.equal(
      validateFetchUrl("https://example.com/docs", 2000).hostname,
      "example.com"
    );
    assert.equal(
      validateFetchUrl("http://example.com", 2000).protocol,
      "http:"
    );
  });

  it("rejects non-http schemes, embedded credentials, and over-long URLs", () => {
    assert.throws(() => validateFetchUrl("file:///etc/passwd", 2000));
    assert.throws(() => validateFetchUrl("ftp://example.com", 2000));
    assert.throws(() =>
      validateFetchUrl("https://user:pass@example.com", 2000)
    );
    assert.throws(() => validateFetchUrl("not a url", 2000));
    assert.throws(() => validateFetchUrl("https://example.com", 8));
  });
});

describe("isSameOrigin", () => {
  it("compares scheme, hostname, and port", () => {
    assert.equal(
      isSameOrigin(
        new URL("https://example.com/a"),
        new URL("https://example.com/b")
      ),
      true
    );
    assert.equal(
      isSameOrigin(
        new URL("https://example.com/a"),
        new URL("http://example.com/b")
      ),
      false
    );
    assert.equal(
      isSameOrigin(
        new URL("https://example.com:8443/a"),
        new URL("https://example.com/b")
      ),
      false
    );
  });
});

describe("classifyContentType", () => {
  it("classifies html, text, markdown, and structured text", () => {
    assert.equal(classifyContentType("text/html; charset=utf-8"), "html");
    assert.equal(classifyContentType("application/xhtml+xml"), "html");
    // Accept: text/markdown negotiation (RFC 7763) — a markdown body is
    // already agent-ready and passes through without HTML conversion.
    assert.equal(
      classifyContentType("text/markdown; charset=utf-8"),
      "markdown"
    );
    assert.equal(classifyContentType("text/x-markdown"), "markdown");
    assert.equal(classifyContentType("text/plain"), "text");
    assert.equal(classifyContentType("application/json"), "text");
    assert.equal(classifyContentType("application/problem+json"), "text");
    assert.equal(classifyContentType("application/xml"), "text");
  });

  it("rejects binary content types", () => {
    assert.equal(classifyContentType("application/pdf"), undefined);
    assert.equal(classifyContentType("image/png"), undefined);
    assert.equal(classifyContentType(null), undefined);
  });
});

describe("parseCharset", () => {
  it("extracts the declared charset or defaults to undefined (utf-8)", () => {
    assert.equal(parseCharset("text/html; charset=utf-8"), "utf-8");
    assert.equal(parseCharset('text/html; charset="iso-8859-1"'), "iso-8859-1");
    assert.equal(parseCharset("text/html"), undefined);
  });
});

describe("markdownAlternateFromLink", () => {
  it("returns the first rel=alternate; type=text/markdown target", () => {
    const header =
      '<https://example.com/posts/1>; rel="canonical", ' +
      '<https://example.com/posts/1.md>; rel="alternate"; type="text/markdown"';
    assert.equal(
      markdownAlternateFromLink(header),
      "https://example.com/posts/1.md"
    );
  });

  it("ignores alternates that are not markdown, and markdown links that are not alternates", () => {
    assert.equal(
      markdownAlternateFromLink(
        '<https://example.com/x.pdf>; rel="alternate"; type="application/pdf"'
      ),
      undefined
    );
    assert.equal(
      markdownAlternateFromLink(
        '<https://example.com/x.md>; rel="stylesheet"; type="text/markdown"'
      ),
      undefined
    );
  });

  it("matches markdown types with parameters and quoted rel lists", () => {
    assert.equal(
      markdownAlternateFromLink(
        '<https://example.com/x.md>; rel="alternate stylesheet"; type="text/markdown; variant=CommonMark"'
      ),
      "https://example.com/x.md"
    );
  });

  it("returns undefined for no header or no matching link", () => {
    assert.equal(markdownAlternateFromLink(null), undefined);
    assert.equal(markdownAlternateFromLink("not a link header"), undefined);
  });
});
