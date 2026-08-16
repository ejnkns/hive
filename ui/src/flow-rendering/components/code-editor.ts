/** @public — the editable TypeScript code editor (textarea over a highlighted
 * overlay, scroll-synced) for the flow-editor. */

import { css, html, LitElement } from "lit";
import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { highlightTypeScript } from "../ts-highlight.ts";

// A controlled code editor: the parent owns `value` and feeds it back on
// hive-code-change (the round-trip guard lives in the parent, so a WS
// snapshot reflecting the parent's own write-back never clears the user's
// typing). The highlighted overlay renders the same text with the same
// metrics underneath a transparent-text textarea, so the caret stays visible
// and the syntax colors show through.

export class CodeEditor extends LitElement {
  static properties = {
    value: { attribute: false },
    disabled: { type: Boolean },
  };

  static styles = css`
    :host {
      display: block;
      position: relative;
    }

    .code {
      margin: 0;
      padding: 0.375rem 0.5rem;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-family: var(--font-mono, monospace);
      font-size: 0.625rem;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text);
    }

    textarea {
      position: absolute;
      inset: 0;
      z-index: 1;
      width: 100%;
      height: 100%;
      background: transparent;
      color: transparent;
      caret-color: var(--text);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.375rem 0.5rem;
      font-family: var(--font-mono, monospace);
      font-size: 0.625rem;
      line-height: 1.45;
      tab-size: 2;
      resize: vertical;
      outline: none;
      overflow: auto;
    }

    textarea:focus {
      border-color: var(--flow-accent, var(--accent));
    }

    textarea:disabled {
      opacity: 0.6;
    }

    .code :global(.tok-keyword) {
      color: var(--flow-accent, var(--accent));
    }

    .code :global(.tok-string) {
      color: var(--success);
    }

    .code :global(.tok-number) {
      color: var(--warning);
    }

    .code :global(.tok-comment) {
      color: var(--muted);
      font-style: italic;
    }
  `;

  value = "";
  disabled = false;

  private overlayRef: Ref<HTMLPreElement> = createRef();

  render() {
    return html`
      <pre class="code" ${ref(this.overlayRef)} aria-hidden="true"
        >${unsafeHTML(highlightTypeScript(this.value))}</pre
      >
      <textarea
        .value=${this.value}
        ?disabled=${this.disabled}
        spellcheck=${"false"}
        @input=${this.handleInput}
        @scroll=${this.handleScroll}
      ></textarea>
    `;
  }

  private handleInput = (event: Event): void => {
    const textarea = event.target as HTMLTextAreaElement;
    this.dispatchEvent(
      new CustomEvent("hive-code-change", {
        detail: { value: textarea.value },
        bubbles: true,
        composed: true,
      })
    );
  };

  private handleScroll = (event: Event): void => {
    const overlay = this.overlayRef.value;
    if (overlay === undefined) return;
    const textarea = event.target as HTMLTextAreaElement;
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
  };
}

customElements.define("code-editor", CodeEditor);
