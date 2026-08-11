import { css, html, LitElement } from "lit";
import type { VisibleAction } from "workflow-engine/workflow-types";
import "./config-field-form.ts";
import type { ConfigFieldValue } from "./config-field-form.ts";

// The action row on a workflow instance: buttons per available action, with a
// two-click confirm for destructive variants and an inline form when an action
// declares input fields (the collected values dispatch with the action and are
// written into the instance's state). The form itself lives in
// <config-field-form>, shared with the instance-edit affordance.
export class ActionBar extends LitElement {
  static properties = {
    actions: { attribute: false },
    // Reactive so the confirm step re-renders when a destructive action is
    // clicked (a plain field would update state with no render).
    pendingConfirm: { attribute: false },
    formAction: { attribute: false },
    // Payload collected from a fielded action's form, held until the confirm
    // step completes (the "confirm + reason" pattern: form → confirm →
    // dispatch with the collected values).
    pendingPayload: { attribute: false },
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

    button:disabled {
      opacity: 0.5;
      cursor: default;
    }

    button.primary {
      background: var(--success);
      color: var(--bg);
      border-color: transparent;
    }

    button.primary:hover:not(:disabled) {
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
  formAction: VisibleAction | null = null;
  pendingPayload: Record<string, unknown> | null = null;

  render() {
    const formAction = this.formAction;
    if (formAction !== null && formAction.fields !== undefined) {
      return html`<config-field-form
        .fields=${formAction.fields}
        .values=${{}}
        @hive-fields-submit=${(
          event: CustomEvent<{ values: Record<string, ConfigFieldValue> }>
        ) => this.submitForm(formAction, event.detail.values)}
        @hive-fields-cancel=${() => (this.formAction = null)}
      ></config-field-form>`;
    }
    return html`<div class="actions">
      ${this.actions.map((action) =>
        this.pendingConfirm === action.id
          ? html`<div class="confirm-row">
              <span class="confirm-text"
                >${
                  action.confirmText ?? `Confirm ${action.label.toLowerCase()}?`
                }</span
              >
              <button
                class="destructive"
                type="button"
                @click=${() => this.confirm(action.id)}
              >
                Confirm
              </button>
              <button type="button" @click=${() => this.dismissConfirm()}>
                Cancel
              </button>
            </div>`
          : html`<button
              class=${action.variant}
              type="button"
              @click=${() => this.handleAction(action)}
            >
              ${action.label}
            </button>`
      )}
    </div>`;
  }

  private handleAction(action: VisibleAction): void {
    if (action.fields !== undefined && action.fields.length > 0) {
      this.pendingPayload = null;
      this.formAction = action;
      return;
    }
    if (this.needsConfirm(action)) {
      this.pendingConfirm = action.id;
      return;
    }
    this.emitAction(action.id);
  }

  // An action confirms when it is destructive (default) or when it declares
  // custom confirm wording — the confirm step is opt-in beyond destructive.
  private needsConfirm(action: VisibleAction): boolean {
    return action.variant === "destructive" || action.confirmText !== undefined;
  }

  private confirm(actionId: string): void {
    this.pendingConfirm = null;
    const payload = this.pendingPayload;
    this.pendingPayload = null;
    this.emitAction(actionId, payload ?? undefined);
  }

  private dismissConfirm(): void {
    this.pendingConfirm = null;
    this.pendingPayload = null;
  }

  private submitForm(
    action: VisibleAction,
    values: Record<string, ConfigFieldValue>
  ): void {
    this.formAction = null;
    // A destructive (or confirmText-declaring) fielded action collects the
    // payload first, then asks for confirmation before dispatching.
    if (this.needsConfirm(action)) {
      this.pendingPayload = values;
      this.pendingConfirm = action.id;
      return;
    }
    this.emitAction(action.id, values);
  }

  private emitAction(
    actionId: string,
    payload?: Record<string, unknown>
  ): void {
    this.dispatchEvent(
      new CustomEvent("hive-action", {
        detail: { actionId, payload },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("action-bar", ActionBar);
