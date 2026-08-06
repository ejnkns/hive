/** @private — only imported by DefinitionEditor.svelte */

// A lightweight TypeScript tokenizer for editor highlighting: comments,
// strings, numbers, and keywords get wrapped in token spans; everything else is
// HTML-escaped plain text. Not a parser — good enough to make a definition
// source readable without pulling in an editor framework.
const TOKEN_PATTERN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)\b/g;

const KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "boolean",
  "const",
  "else",
  "export",
  "extends",
  "false",
  "for",
  "from",
  "function",
  "if",
  "import",
  "interface",
  "let",
  "never",
  "new",
  "null",
  "number",
  "readonly",
  "return",
  "satisfies",
  "string",
  "true",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
]);

export function highlightTypeScript(source: string): string {
  let out = "";
  let lastIndex = 0;
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    out += escapeHtml(source.slice(lastIndex, index));
    const [full, comment, string, number, identifier] = match;
    if (comment !== undefined) {
      out += `<span class="tok-comment">${escapeHtml(comment)}</span>`;
    } else if (string !== undefined) {
      out += `<span class="tok-string">${escapeHtml(string)}</span>`;
    } else if (number !== undefined) {
      out += `<span class="tok-number">${escapeHtml(number)}</span>`;
    } else if (identifier !== undefined) {
      out += KEYWORDS.has(identifier)
        ? `<span class="tok-keyword">${escapeHtml(identifier)}</span>`
        : escapeHtml(identifier);
    } else {
      out += escapeHtml(full);
    }
    lastIndex = index + full.length;
  }
  out += escapeHtml(source.slice(lastIndex));
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
