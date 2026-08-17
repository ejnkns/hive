/** @public — dep-free HTML → light-markdown conversion for web content.
 *
 * The model-facing half of web_fetch: a fetched HTML body becomes compact
 * markdown — chrome dropped, structure preserved, whitespace collapsed — so
 * the agent gets content, not markup, and tokens stay proportional to what a
 * page says. No DOM, no dependencies: a single-pass tokenizer over the HTML
 * string with an element stack.
 *
 * Robustness invariants (mirroring deepseek-harness's web-fetch-http):
 * - A nesting-depth ceiling bails conversion and passes the (already bounded)
 *   source through raw — an unclosed-tag bomb must not make the walk
 *   superlinear.
 * - The source is cut before conversion (maxInputChars); the caller caps the
 *   final output separately.
 */

// Elements whose text is never model-facing content.
const DROPPED_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "iframe",
  "svg",
]);

// Elements that never take a closing tag.
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Elements whose body is text until their matching end tag (no markup
// interpretation inside).
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "noscript"]);

// Nesting-depth ceiling (deepseek-harness's MAX_CONVERSION_DEPTH).
const MAX_DEPTH = 512;

export type HtmlToTextOptions = {
  // Maximum source characters processed synchronously; the body is cut before
  // conversion so the walk is bounded.
  maxInputChars?: number;
};

export type HtmlToTextResult = {
  text: string;
  // True when the source was cut before conversion (the caller's output cap
  // is a separate flag).
  truncated: boolean;
};

export function htmlToText(
  html: string,
  options: HtmlToTextOptions = {}
): HtmlToTextResult {
  const content =
    options.maxInputChars !== undefined
      ? html.slice(0, options.maxInputChars)
      : html;
  const sourceTruncated = content.length !== html.length;

  // A body nested beyond the depth ceiling passes through raw (bounded) — a
  // degraded page beats an error, and the raw source is already cut.
  if (exceedsDepth(content)) {
    return { text: content, truncated: true };
  }

  return { text: convert(content), truncated: sourceTruncated };
}

// ── lexical guard ─────────────────────────────────────────────────────

// Whether the element stack crosses MAX_DEPTH. Single pass, tolerant of
// malformed input (over-counts rather than hiding nesting): comments and
// raw-text bodies are skipped, quoted ">" inside attributes is respected, and
// a closing tag only pops when it matches the current element.
function exceedsDepth(html: string): boolean {
  const lower = html.toLowerCase();
  const stack: string[] = [];
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf("<", offset);
    if (start === -1) break;

    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      offset = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", start)) {
      // Other declarations (doctype, CDATA) carry no model-facing text.
      const end = html.indexOf(">", start);
      offset = end === -1 ? html.length : end + 1;
      continue;
    }

    let cursor = start + 1;
    const closing = html[cursor] === "/";
    if (closing) cursor += 1;
    const nameStart = cursor;
    while (/[a-zA-Z0-9-]/.test(html[cursor] ?? "")) cursor += 1;
    if (cursor === nameStart) {
      offset = start + 1;
      continue;
    }
    const name = lower.slice(nameStart, cursor);

    // Skip to the tag end, respecting quoted ">".
    let quote: '"' | "'" | undefined;
    while (cursor < html.length) {
      const char = html[cursor];
      cursor += 1;
      if (quote !== undefined) {
        if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
    }

    if (closing) {
      if (stack.at(-1) === name) stack.pop();
    } else if (!VOID_ELEMENTS.has(name)) {
      let last = cursor - 2;
      while (/\s/.test(html.charAt(last))) last -= 1;
      const selfClosing = html[last] === "/";
      if (!selfClosing) {
        stack.push(name);
        if (stack.length > MAX_DEPTH) return true;
        if (RAW_TEXT_ELEMENTS.has(name)) {
          offset = skipRawText(lower, name, cursor);
          continue;
        }
      }
    }
    offset = cursor;
  }
  return false;
}

// The end of a raw-text element body (script/style), without interpreting
// markup-like text.
function skipRawText(lower: string, name: string, from: number): number {
  const prefix = `</${name}`;
  let candidate = lower.indexOf(prefix, from);
  while (candidate !== -1) {
    const boundary = lower[candidate + prefix.length];
    if (boundary === undefined || boundary === ">" || /\s/.test(boundary)) {
      return candidate;
    }
    candidate = lower.indexOf(prefix, candidate + prefix.length);
  }
  return lower.length;
}

// ── conversion ────────────────────────────────────────────────────────

// One pass over the HTML building a line buffer. Block elements emit line
// breaks; phrasing elements emit inline markers; dropped elements suppress
// their subtree; whitespace is collapsed at the line level.
function convert(html: string): string {
  const lines: string[] = [];
  let line = "";
  const stack: string[] = [];
  // How many dropped ancestors are open: while > 0, no text is emitted.
  let dropDepth = 0;

  const pushLine = (): void => {
    const trimmed = line.trim().replace(/\s+/g, " ");
    if (trimmed !== "") lines.push(trimmed);
    line = "";
  };
  const emitBlockBreak = (): void => {
    pushLine();
  };

  let offset = 0;
  while (offset < html.length) {
    const start = html.indexOf("<", offset);
    if (start === -1) {
      if (dropDepth === 0) line += html.slice(offset);
      break;
    }
    if (start > offset && dropDepth === 0) {
      line += html.slice(offset, start);
    }
    offset = start;

    if (html.startsWith("<!--", offset)) {
      const end = html.indexOf("-->", offset + 4);
      offset = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", offset)) {
      // Other declarations (doctype, CDATA) carry no model-facing text.
      const end = html.indexOf(">", offset);
      offset = end === -1 ? html.length : end + 1;
      continue;
    }

    let cursor = offset + 1;
    const closing = html[cursor] === "/";
    if (closing) cursor += 1;
    const nameStart = cursor;
    while (/[a-zA-Z0-9-]/.test(html[cursor] ?? "")) cursor += 1;
    if (cursor === nameStart) {
      offset += 1;
      continue;
    }
    const name = html.slice(nameStart, cursor).toLowerCase();

    let quote: '"' | "'" | undefined;
    while (cursor < html.length) {
      const char = html[cursor];
      cursor += 1;
      if (quote !== undefined) {
        if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
    }
    offset = cursor;

    if (closing) {
      if (DROPPED_ELEMENTS.has(name) && stack.at(-1) === name) {
        if (dropDepth > 0) dropDepth -= 1;
        stack.pop();
        continue;
      }
      const closed = stack.pop();
      if (closed === "strong" || closed === "b") line += "**";
      if (closed === "em" || closed === "i") line += "*";
      if (closed === "code" && !stack.includes("pre")) line += "`";
      if (closed === "p" || closed === "li" || closed === "div")
        emitBlockBreak();
      if (closed === "td" || closed === "th") line += " | ";
      if (closed === "tr") emitBlockBreak();
      if (closed === "pre") {
        pushLine();
        line += "```";
        pushLine();
      }
      if (closed === "h1") pushLine();
      if (closed === "h2") pushLine();
      if (closed === "h3") pushLine();
      if (closed === "h4") pushLine();
      if (closed === "h5") pushLine();
      if (closed === "h6") pushLine();
      continue;
    }

    // Opening (or self-closing/void) tag.
    if (DROPPED_ELEMENTS.has(name)) {
      if (!VOID_ELEMENTS.has(name)) {
        stack.push(name);
        dropDepth += 1;
      }
      continue;
    }
    if (VOID_ELEMENTS.has(name)) {
      if (name === "br") {
        emitBlockBreak();
      }
      continue;
    }
    stack.push(name);

    if (name === "li") {
      line = line.trimEnd() === "" ? "- " : `${line.trimEnd()}\n- `;
    } else if (name === "td" || name === "th") {
      if (!line.endsWith("| ")) line += "| ";
    } else if (name === "h1") {
      emitBlockBreak();
      line += "# ";
    } else if (name === "h2") {
      emitBlockBreak();
      line += "## ";
    } else if (name === "h3") {
      emitBlockBreak();
      line += "### ";
    } else if (name === "h4") {
      emitBlockBreak();
      line += "#### ";
    } else if (name === "h5") {
      emitBlockBreak();
      line += "##### ";
    } else if (name === "h6") {
      emitBlockBreak();
      line += "###### ";
    } else if (name === "pre") {
      emitBlockBreak();
      line += "```";
      pushLine();
    } else if (
      name === "p" ||
      name === "div" ||
      name === "article" ||
      name === "main" ||
      name === "section"
    ) {
      emitBlockBreak();
    } else if (name === "strong" || name === "b") {
      line += "**";
    } else if (name === "em" || name === "i") {
      line += "*";
    } else if (name === "code") {
      if (!stack.includes("pre")) line += "`";
    } else if (name === "a") {
      // Keep the link text; the agent already knows the fetched URL.
      // nothing to emit
    }
  }

  if (dropDepth === 0) {
    line += "";
  }
  pushLine();
  return lines.join("\n");
}
