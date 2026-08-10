import { css, html, LitElement, nothing } from "lit";
import type {
  ConfigField,
  VisibleAction,
} from "workflow-engine/workflow-types";

// The action row on a workflow instance: buttons per available action, with a
// two-click confirm for destructive variants and an inline form when an action
// declares input fields (the collected values dispatch with the action and are
// written into the instance's state).
export class ActionBar extends LitElement {
  static properties = {
    actions: { attribute: false },
    // Reactive so the confirm step re-renders when a destructive action is
    // clicked (a plain field would update state with no render).
    pendingConfirm: { attribute: false },
    formAction: { attribute: false },
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

    .form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      width: 100%;
      padding: 0.5rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
    }

    .form-field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .form-label {
      font-size: 0.625rem;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .form-hint {
      font-size: 0.625rem;
      color: var(--muted);
    }

    .form-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    input[type="text"],
    select {
      font: inherit;
      font-size: 0.6875rem;
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--surface);
      color: var(--text);
      outline: none;
    }

    input[type="text"]:focus,
    select:focus {
      border-color: var(--accent);
    }

    .form-actions {
      display: flex;
      gap: 0.375rem;
      justify-content: flex-end;
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
  private formValues: Record<string, string | boolean | number> = {};

  render() {
    const formAction = this.formAction;
    if (formAction !== null && formAction.fields !== undefined) {
      return html`<div class="form">
        ${formAction.fields.map((field) => this.renderField(field))}
        <div class="form-actions">
          <button
            class="primary"
            ?disabled=${!this.formValid(formAction.fields)}
            @click=${() => this.submitForm(formAction)}
          >
            Submit
          </button>
          <button @click=${() => (this.formAction = null)}>Cancel</button>
        </div>
      </div>`;
    }
    return html`<div class="actions">
      ${this.actions.map((action) =>
        this.pendingConfirm === action.id
          ? html`<div class="confirm-row">
              <span class="confirm-text"
                >Confirm ${action.label.toLowerCase()}?</span
              >
              <button
                class="destructive"
                @click=${() => this.confirm(action.id)}
              >
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

  private renderField(field: ConfigField) {
    const value = this.formValues[field.key];
    if (field.type === "boolean") {
      return html`<label class="form-field">
        <span class="form-label">${field.label}</span>
        <span class="form-row">
          <input
            type="checkbox"
            ?checked=${value === true}
            @change=${(event: Event) => {
              this.formValues[field.key] = (
                event.target as HTMLInputElement
              ).checked;
              this.requestUpdate();
            }}
          />
          ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
        </span>
      </label>`;
    }
    if (field.options && field.options.length > 0) {
      return html`<label class="form-field">
        <span class="form-label"
          >${field.label}${field.required ? " *" : ""}</span
        >
        <select
          @change=${(event: Event) => {
            this.formValues[field.key] = (
              event.target as HTMLSelectElement
            ).value;
            this.requestUpdate();
          }}
        >
          <option value="" ?selected=${value === undefined} disabled>
            Select...
          </option>
          ${field.options.map(
            (option) => html`<option
              value=${option}
              ?selected=${value === option}
            >
              ${option}
            </option>`
          )}
        </select>
      </label>`;
    }
    return html`<label class="form-field">
      <span class="form-label"
        >${field.label}${field.required ? " *" : ""}</span
      >
      <input
        type="text"
        .value=${typeof value === "string" ? value : ""}
        placeholder=${field.hint ?? ""}
        @input=${(event: Event) => {
          this.formValues[field.key] = (event.target as HTMLInputElement).value;
          this.requestUpdate();
        }}
      />
    </label>`;
  }

  private formValid(fields: ConfigField[]): boolean {
    return fields.every((field) => {
      const value = this.formValues[field.key];
      if (field.type === "boolean") return true;
      return value !== undefined && String(value).trim() !== "";
    });
  }

  private handleAction(action: VisibleAction): void {
    if (action.fields !== undefined && action.fields.length > 0) {
      this.formValues = {};
      this.formAction = action;
      return;
    }
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

  private submitForm(action: VisibleAction): void {
    this.formAction = null;
    this.emitAction(action.id, { ...this.formValues });
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
