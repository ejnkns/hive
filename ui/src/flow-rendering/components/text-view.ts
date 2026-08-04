import { css, html, LitElement } from "lit";

export class TextView extends LitElement {
  static properties = {
    content: { type: String },
  };

  static styles = css`
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text);
      font-family: var(--font-mono, monospace);
      font-size: 0.625rem;
    }
  `;

  content = "";

  render() {
    return html`<pre>${this.content}</pre>`;
  }
}

customElements.define("text-view", TextView);
