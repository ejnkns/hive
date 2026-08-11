import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeMarkdown } from "./sanitize.ts";

describe("sanitizeMarkdown", () => {
  it("renders markdown structure", () => {
    const html = sanitizeMarkdown("# Title\n\nSome *text*.");
    assert.match(html, /<h1[^>]*>Title<\/h1>/);
    assert.match(html, /<em>text<\/em>/);
  });

  it("drops raw HTML so a model cannot inject markup", () => {
    const html = sanitizeMarkdown("hello <script>alert(1)</script>");
    assert.ok(!html.includes("<script>"), "script tags must not survive");
    assert.ok(!html.includes("<img"), "img tags must not survive");
  });

  it("drops inline HTML tags and attributes", () => {
    const html = sanitizeMarkdown('text <img src="x" onerror="evil()">');
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("onerror"));
  });
});
