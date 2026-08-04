import { css, html, LitElement } from "lit";

export class TaskErrorView extends LitElement {
  static properties = {
    error: { type: String },
  };

  static styles = css`
    .error {
      color: var(--error);
      white-space: pre-wrap;
      font-size: 0.625rem;
    }
  `;

  error = "";

  render() {
    return html`<div class="error">${this.error}</div>`;
  }
}

customElements.define("task-error-view", TaskErrorView);
