/** @private — only imported by markdown-view.ts */

import { Marked } from "marked";

// AI-authored markdown is rendered, never executed: raw HTML tokens in the
// source are dropped so a model cannot inject markup.
const markdown = new Marked({
  renderer: {
    html() {
      return "";
    },
  },
});

export function sanitizeMarkdown(source: string): string {
  // The Marked instance runs synchronously (async defaults to false); the
  // union return type is a marked API artifact, so the string cast is safe.
  return markdown.parse(source) as string;
}
