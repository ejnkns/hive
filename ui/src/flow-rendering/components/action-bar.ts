import { css, html, LitElement } from "lit";
import type { VisibleAction } from "workflow-engine/workflow-types";

export class ActionBar extends LitElement {
  static properties = {
    actions: { attribute: false },
    // Reactive so the confirm step re-renders when a destructive action is
    // clicked (a plain field would update state with no render).
    pendingConfirm: { attribute: false },
  };

  static styles = css`
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }

    .confirm-row {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      width: 100%;
      padding: 0.25rem;
      background: rgba(212, 69, 26, 0.08);
      border: 1px solid rgba(212, 69, 26, 0.2);
      border-radius: 4px;
    }

    .confirm-text {
      font-size: 0.625rem;
      color: var(--error);
      font-weight: 600;
      margin-right: auto;
    }

    button {
      font-family: inherit;
      font-size: 0.6875rem;
      height: 26px;
      padding: 0 0.625rem;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: background 0.15s, filter 0.15s;
    }

    button:hover {
      background: var(--border);
    }

    button.primary {
      background: var(--success);
      color: var(--bg);
      border-color: transparent;
    }

    button.primary:hover {
      filter: brightness(1.1);
    }

    button.destructive {
      background: var(--error);
      color: white;
      border-color: transparent;
    }

    button.destructive:hover {
      filter: brightness(1.1);
    }
  `;

  actions: VisibleAction[] = [];

  pendingConfirm: string | null = null;

  render() {
    return html`<div class="actions">
      ${this.actions.map((action) =>
        this.pendingConfirm === action.id
          ? html`<div class="confirm-row">
              <span class="confirm-text"
                >Confirm ${action.label.toLowerCase()}?</span
              >
              <button class="destructive" @click=${() => this.confirm(action.id)}>
                Confirm
              </button>
              <button @click=${() => (this.pendingConfirm = null)}>
                Cancel
              </button>
            </div>`
          : html`<button
              class=${action.variant}
              @click=${() => this.handleAction(action)}
            >
              ${action.label}
            </button>`
      )}
    </div>`;
  }

  private handleAction(action: VisibleAction): void {
    if (action.variant === "destructive") {
      this.pendingConfirm = action.id;
      return;
    }
    this.emitAction(action.id);
  }

  private confirm(actionId: string): void {
    this.pendingConfirm = null;
    this.emitAction(actionId);
  }
  private emitAction(actionId: string): void {
    this.dispatchEvent(
      new CustomEvent("hive-action", {
        detail: { actionId },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("action-bar", ActionBar);
