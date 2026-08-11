import { css, html, LitElement, type PropertyValues } from "lit";
import type { ConfigField } from "workflow-engine/workflow-types";
import "./config-field-control";
import type { ConfigFieldValue } from "./config-field-control";

// The inline ConfigField form. Shared by the action-bar (action payloads) and
// the instance-edit form (WorkflowConfig.editFields, gap 2): one
// <config-field-control> per ConfigField type, pre-filled from `values`
// (current instance state for the edit form) then each field's defaultValue,
// local required/emptiness gating, and a hive-fields-submit /
// hive-fields-cancel contract. The engine's collectConfigFieldValues remains
// the validation authority — this form only gates submission on
// required-emptiness so the server error is the exception, not the norm.
//
// The form owns the submitted values: each control emits hive-field-change
// with { key, value } and the form tracks the map (re-feeding it back as the
// controls' `value` prop), so the submit gate sees the latest draft.
//
// Submit payload: required/empty values stripped for non-required fields (an
// untouched optional field stays absent — matching the engine's skip-on-absent
// semantics); required fields are guaranteed present by the submit gate.

export type { ConfigFieldValue } from "./config-field-control";

export class ConfigFieldForm extends LitElement {
  static properties = {
    fields: { attribute: false },
    values: { attribute: false },
    submitLabel: { attribute: false },
  };

  static styles = css`
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
  `;

  fields: ConfigField[] = [];
  values: Record<string, ConfigFieldValue> = {};
  submitLabel = "Submit";

  private current: Record<string, ConfigFieldValue | undefined> = {};

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("values") || changed.has("fields")) {
      this.reset();
    }
  }

  // Each field starts at the provided value (current instance state for the
  // edit form) or its declared defaultValue.
  private reset(): void {
    const next: Record<string, ConfigFieldValue | undefined> = {};
    for (const field of this.fields) {
      const value = this.values[field.key];
      if (value !== undefined) {
        next[field.key] = value;
      } else if (field.defaultValue !== undefined) {
        next[field.key] = field.defaultValue as ConfigFieldValue;
      }
    }
    this.current = next;
  }

  render() {
    return html`<form class="form" @submit=${this.handleSubmit}>
      ${this.fields.map(
        (field) => html`<config-field-control
          .field=${field}
          .value=${this.current[field.key]}
          @hive-field-change=${this.handleFieldChange}
        ></config-field-control>`
      )}
      <div class="form-actions">
        <button
          class="primary"
          type="submit"
          ?disabled=${!this.formValid()}
        >
          ${this.submitLabel}
        </button>
        <button type="button" @click=${() => this.emitCancel()}>Cancel</button>
      </div>
    </form>`;
  }

  private handleFieldChange = (
    event: CustomEvent<{ key: string; value: ConfigFieldValue | undefined }>
  ): void => {
    this.current[event.detail.key] = event.detail.value;
    this.requestUpdate();
  };

  private formValid(): boolean {
    return this.fields.every((field) => {
      const value = this.current[field.key];
      if (field.type === "boolean") return true;
      if (!field.required) return true;
      if (value === undefined) return false;
      if (typeof value === "string") return value.trim() !== "";
      if (Array.isArray(value)) return value.length > 0;
      return true;
    });
  }

  // Real form semantics: Enter submits (preventDefault keeps the page from
  // reloading), the primary button is type=submit, Cancel is type=button.
  private handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    this.submit();
  };

  private submit(): void {
    // Required fields are guaranteed present by formValid; strip empty
    // non-required values so an untouched optional field stays absent (the
    // engine's collector skips absent optionals).
    const values: Record<string, ConfigFieldValue> = {};
    for (const field of this.fields) {
      const value = this.current[field.key];
      if (value === undefined) continue;
      if (!field.required && this.isEmpty(value)) continue;
      values[field.key] = value;
    }
    this.dispatchEvent(
      new CustomEvent("hive-fields-submit", {
        detail: { values },
        bubbles: true,
        composed: true,
      })
    );
  }

  private emitCancel(): void {
    this.dispatchEvent(
      new CustomEvent("hive-fields-cancel", { bubbles: true, composed: true })
    );
  }

  private isEmpty(value: ConfigFieldValue): boolean {
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }
}

customElements.define("config-field-form", ConfigFieldForm);
