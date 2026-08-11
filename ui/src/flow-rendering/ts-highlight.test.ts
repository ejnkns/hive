import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { highlightTypeScript } from "./ts-highlight.ts";

describe("highlightTypeScript", () => {
  it("wraps keywords, strings, comments, and numbers in token spans", () => {
    const html = highlightTypeScript('const n = 1; // note\nconst s = "hi";');
    assert.match(html, /<span class="tok-keyword">const<\/span>/);
    assert.match(html, /<span class="tok-number">1<\/span>/);
    assert.match(html, /<span class="tok-comment">\/\/ note<\/span>/);
    assert.match(html, /<span class="tok-string">"hi"<\/span>/);
  });

  it("escapes HTML in the source so it cannot inject markup", () => {
    const html = highlightTypeScript('type T = { a: string } & "<x>"');
    assert.ok(!html.includes("<x>"));
    assert.ok(html.includes("&lt;x&gt;"));
    assert.ok(html.includes("&amp;"));
  });

  it("highlights block comments", () => {
    const html = highlightTypeScript("/* block */ const a = 1;");
    assert.match(html, /<span class="tok-comment">\/\* block \*\/<\/span>/);
  });

  it("leaves punctuation and identifiers as escaped plain text", () => {
    const html = highlightTypeScript("const myFlow = { id: 1 };");
    assert.ok(html.includes("myFlow = {"));
    assert.ok(!html.includes(">myFlow<"));
    assert.ok(!html.includes(">id<"));
  });
});
