import { css, html, LitElement } from "lit";
import type { FlowLevelAction } from "../../flow-api.ts";

// The flow-level action strip: one button per available flow-level action
// (Add ticket / fog / build). A createInstance action signals the shell to
// open the create-form dialog (onCreate); any other action dispatches
// directly (onFlowAction). The dialog itself stays in the Svelte shell — this
// element only signals intent.
export class FlowActionsBar extends LitElement {
  static properties = {
    actions: { attribute: false },
    onFlowAction: { attribute: false },
    onCreate: { attribute: false },
  };

  static styles = css`
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      padding: 0.5rem 0 0.75rem;
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

  actions: FlowLevelAction[] = [];

  onFlowAction: ((actionId: string) => void) | undefined = undefined;
  onCreate: ((actionId: string) => void) | undefined = undefined;

  render() {
    return html`<div class="actions">
      ${this.actions.map((action) => this.renderAction(action))}
    </div>`;
  }

  private renderAction(action: FlowLevelAction) {
    return html`<button
      class=${action.variant}
      type="button"
      @click=${() => this.handleAction(action)}
    >
      ${action.label}
    </button>`;
  }

  private handleAction(action: FlowLevelAction): void {
    if (action.createInstance !== undefined) {
      this.onCreate?.(action.id);
      return;
    }
    this.onFlowAction?.(action.id);
  }
}

customElements.define("flow-actions-bar", FlowActionsBar);
