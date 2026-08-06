import { css, html, LitElement } from "lit";

// A deterministic operation is a short sync task; show a compact running state
// with a spinner rather than a bare label.
export class OperationStatus extends LitElement {
  static styles = css`
    .status {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.625rem;
      color: var(--muted);
    }

    .spinner {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 1.5px solid var(--border);
      border-top-color: var(--accent);
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  render() {
    return html`<span class="status"
      ><span class="spinner"></span>Operation in progress...</span
    >`;
  }
}

customElements.define("operation-status", OperationStatus);
