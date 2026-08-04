import { css, html, LitElement } from "lit";

export class OperationStatus extends LitElement {
  static styles = css`
    span {
      font-size: 0.625rem;
      color: var(--muted);
    }
  `;

  render() {
    return html`<span>Operation in progress...</span>`;
  }
}

customElements.define("operation-status", OperationStatus);
