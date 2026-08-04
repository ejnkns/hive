import { css, html, LitElement } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
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

export class MarkdownView extends LitElement {
  static properties = {
    content: { type: String },
  };

  static styles = css`
    .markdown {
      font-size: 0.6875rem;
      line-height: 1.55;
      color: var(--text);
      word-break: break-word;
    }

    .markdown :is(p, ul, ol, pre, blockquote) {
      margin: 0 0 0.5rem 0;
    }

    .markdown :is(ul, ol) {
      padding-left: 1.25rem;
    }

    .markdown :is(h1, h2, h3, h4, h5, h6) {
      font-weight: 700;
      margin: 0.75rem 0 0.375rem 0;
    }

    .markdown h1 {
      font-size: 0.9375rem;
    }

    .markdown h2 {
      font-size: 0.875rem;
    }

    .markdown h3 {
      font-size: 0.8125rem;
    }

    .markdown :is(h4, h5, h6) {
      font-size: 0.75rem;
    }

    .markdown :is(code, pre) {
      font-family: var(--font-mono, monospace);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 0 0.25em;
    }

    .markdown pre {
      padding: 0.5rem;
      overflow-x: auto;
    }

    .markdown pre code {
      background: transparent;
      border: none;
      padding: 0;
    }

    .markdown blockquote {
      border-left: 2px solid var(--border);
      padding-left: 0.625rem;
      color: var(--muted);
    }
  `;

  content = "";

  render() {
    // The Marked instance runs synchronously (async defaults to false); the
    // union return type is a marked API artifact, so the string cast is safe.
    const htmlResult = markdown.parse(this.content) as string;
    return html`<div class="markdown">${unsafeHTML(htmlResult)}</div>`;
  }
}

customElements.define("markdown-view", MarkdownView);
