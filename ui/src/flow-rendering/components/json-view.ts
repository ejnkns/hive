import { css, html, LitElement } from "lit";

export class JsonView extends LitElement {
  static properties = {
    value: { attribute: false },
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

  value: unknown = null;

  render() {
    const text =
      typeof this.value === "string"
        ? this.value
        : JSON.stringify(this.value, null, 2);
    return html`<pre>${text}</pre>`;
  }
}

customElements.define("json-view", JsonView);
