// The dep-free HTML→light-markdown converter: drops chrome elements
// (script/style/noscript/nav/header/footer/aside/form/iframe), renders
// headings/lists/tables/code as markdown, collapses whitespace, and guards
// against pathological nesting (the deepseek-harness depth ceiling — an
// unclosed-tag bomb must not make conversion superlinear).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlToText } from "../web/html-to-text.ts";

describe("htmlToText", () => {
  it("extracts the title, headings, and paragraphs as markdown", () => {
    const { text } = htmlToText(`<!doctype html>
<html><head><title>Hive Docs</title></head>
<body>
  <h1>Hive</h1>
  <p>Automatically route LLM traffic to free model providers.</p>
  <h2>Routing</h2>
  <p>Swaps providers on <strong>quality</strong>.</p>
</body></html>`);
    assert.ok(text.includes("Hive Docs"), text);
    assert.ok(text.includes("# Hive"), text);
    assert.ok(text.includes("## Routing"), text);
    assert.ok(text.includes("**quality**"), text);
    assert.ok(text.includes("Automatically route LLM traffic"));
  });

  it("drops chrome: script, style, nav, header, footer, aside, form, iframe", () => {
    const { text } = htmlToText(`<html><body>
  <nav><a href="/">Home</a><a href="/docs">Docs</a></nav>
  <header><h1>Site banner</h1></header>
  <main><p>Real content here.</p></main>
  <aside><p>Ads and related links.</p></aside>
  <footer><p>Copyright</p></footer>
  <script>const secret = "leaked";</script>
  <style>.x { color: red; }</style>
  <form><input name="q"></form>
</body></html>`);
    assert.ok(text.includes("Real content here."), text);
    assert.ok(!text.includes("Site banner"), text);
    assert.ok(!text.includes("Copyright"), text);
    assert.ok(!text.includes("secret"), text);
    assert.ok(!text.includes("Home"), text);
    assert.ok(!text.includes("Ads and related links"), text);
  });

  it("renders lists, links, code, and tables compactly", () => {
    const { text } = htmlToText(`<ul>
  <li>One</li>
  <li>Two</li>
</ul>
<pre><code>const x = 1;</code></pre>
<table><thead><tr><th>A</th><th>B</th></tr></thead>
<tbody><tr><td>1</td><td>2</td></tr></tbody></table>
<p>See <a href="https://example.com">the docs</a>.</p>`);
    assert.ok(text.includes("- One"), text);
    assert.ok(text.includes("- Two"), text);
    assert.ok(text.includes("```"), text);
    assert.ok(text.includes("const x = 1;"), text);
    assert.ok(text.includes("A | B"), text);
    assert.ok(text.includes("1 | 2"), text);
    assert.ok(text.includes("the docs"), text);
  });

  it("collapses whitespace and trims lines", () => {
    const { text } = htmlToText(`<p>  One    two   three  </p>\n<p>four</p>`);
    assert.equal(text, "One two three\nfour");
  });

  it("bounds a pathological nesting depth by returning raw (bounded) source", () => {
    const bomb = "<div>".repeat(10_000) + "content" + "</div>".repeat(10_000);
    const { text, truncated } = htmlToText(bomb);
    // The depth guard bails and the (bounded) source passes through raw rather
    // than burning unbounded CPU in a superlinear walk.
    assert.ok(truncated === true);
    assert.ok(text.includes("content"));
  });

  it("truncates the source before conversion and flags it", () => {
    const body = "<p>" + "word ".repeat(2_000) + "</p>";
    const { text, truncated } = htmlToText(body, { maxInputChars: 500 });
    assert.equal(truncated, true);
    assert.ok(text.length <= 600);
  });
});
