import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import type { ConfigField } from "workflow-engine/workflow-types";

// The inline ConfigField form. Shared by the action-bar (action payloads) and
// the instance-edit form (WorkflowConfig.editFields, gap 2): one control per
// ConfigField type, pre-filled from `values` (current instance state for the
// edit form) then each field's defaultValue, local required/emptiness gating,
// and a hive-fields-submit / hive-fields-cancel contract. The engine's
// collectConfigFieldValues remains the validation authority — this form only
// gates submission on required-emptiness so the server error is the exception,
// not the norm.
//
// Submit payload: required/empty values stripped for non-required fields (an
// untouched optional field stays absent — matching the engine's skip-on-absent
// semantics); required fields are guaranteed present by the submit gate.

export type ConfigFieldFormValue = string | boolean | number | string[];

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
      gap: 0.375rem;
      flex-wrap: wrap;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.6875rem;
      padding: 0.125rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      cursor: pointer;
    }

    .chip.checked {
      border-color: var(--accent);
      background: rgba(96, 216, 116, 0.12);
    }

    input[type="text"],
    input[type="number"],
    input[type="date"],
    input[type="datetime-local"],
    textarea,
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

    textarea {
      resize: vertical;
      min-height: 4rem;
      line-height: 1.35;
    }

    input[type="text"]:focus,
    input[type="number"]:focus,
    input[type="date"]:focus,
    input[type="datetime-local"]:focus,
    textarea:focus,
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
  `;

  fields: ConfigField[] = [];
  values: Record<string, ConfigFieldFormValue> = {};
  submitLabel = "Submit";

  private current: Record<string, ConfigFieldFormValue | undefined> = {};

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("values") || changed.has("fields")) {
      this.reset();
    }
  }

  // Each field starts at the provided value (current instance state for the
  // edit form) or its declared defaultValue.
  private reset(): void {
    const next: Record<string, ConfigFieldFormValue | undefined> = {};
    for (const field of this.fields) {
      const value = this.values[field.key];
      if (value !== undefined) {
        next[field.key] = value;
      } else if (field.defaultValue !== undefined) {
        next[field.key] = field.defaultValue as ConfigFieldFormValue;
      }
    }
    this.current = next;
  }

  render() {
    return html`<div class="form">
      ${this.fields.map((field) => this.renderField(field))}
      <div class="form-actions">
        <button
          class="primary"
          ?disabled=${!this.formValid()}
          @click=${() => this.submit()}
        >
          ${this.submitLabel}
        </button>
        <button @click=${() => this.emitCancel()}>Cancel</button>
      </div>
    </div>`;
  }

  private renderField(field: ConfigField) {
    const value = this.current[field.key];
    const required = field.required ? " *" : "";
    if (field.type === "boolean") {
      return html`<label class="form-field">
        <span class="form-label">${field.label}</span>
        <span class="form-row">
          <input
            type="checkbox"
            ?checked=${value === true}
            @change=${(event: Event) => {
              this.current[field.key] = (
                event.target as HTMLInputElement
              ).checked;
              this.requestUpdate();
            }}
          />
          ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
        </span>
      </label>`;
    }
    if (field.type === "string[]") {
      return this.renderMultiSelect(field, value);
    }
    const label = html`<span class="form-label"
      >${field.label}${required}</span
    >`;
    if (field.options && field.options.length > 0) {
      return html`<label class="form-field">
        ${label}
        <select
          @change=${(event: Event) => {
            this.current[field.key] = (event.target as HTMLSelectElement).value;
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
        ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
      </label>`;
    }
    const placeholder = field.placeholder ?? "";
    if (field.type === "textarea") {
      return html`<label class="form-field">
        ${label}
        <textarea
          placeholder=${placeholder}
          @input=${(event: Event) => {
            this.current[field.key] = (
              event.target as HTMLTextAreaElement
            ).value;
            this.requestUpdate();
          }}
        >${typeof value === "string" ? value : ""}</textarea>
        ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
      </label>`;
    }
    if (field.type === "date") {
      return html`<label class="form-field">
        ${label}
        <input
          type="date"
          .value=${typeof value === "string" ? value : ""}
          placeholder=${placeholder}
          @input=${(event: Event) => {
            this.current[field.key] = (event.target as HTMLInputElement).value;
            this.requestUpdate();
          }}
        />
        ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
      </label>`;
    }
    if (field.type === "datetime") {
      return html`<label class="form-field">
        ${label}
        <input
          type="datetime-local"
          .value=${typeof value === "string" ? value : ""}
          placeholder=${placeholder}
          @input=${(event: Event) => {
            this.current[field.key] = (event.target as HTMLInputElement).value;
            this.requestUpdate();
          }}
        />
        ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
      </label>`;
    }
    const isNumber = field.type === "number";
    return html`<label class="form-field">
      ${label}
      <input
        type=${isNumber ? "number" : "text"}
        .value=${
          typeof value === "string" || typeof value === "number"
            ? String(value)
            : ""
        }
        placeholder=${placeholder}
        @input=${(event: Event) => {
          const input = event.target as HTMLInputElement;
          this.current[field.key] = isNumber
            ? input.value === ""
              ? undefined
              : Number(input.value)
            : input.value;
          this.requestUpdate();
        }}
      />
      ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
    </label>`;
  }

  // A string[] field: with options a multi-select (chip/checkbox group), each
  // chosen value must be in the allowed set; without options a free tag list
  // (comma-separated text input).
  private renderMultiSelect(field: ConfigField, value: unknown) {
    const options = field.options ?? [];
    if (options.length > 0) {
      const selected = Array.isArray(value) ? value : [];
      return html`<span class="form-field">
        <span class="form-label"
          >${field.label}${field.required ? " *" : ""}</span
        >
        <span class="form-row">
          ${options.map((option) => {
            const checked = selected.includes(option);
            return html`<label class="chip ${checked ? "checked" : ""}">
              <input
                type="checkbox"
                ?checked=${checked}
                @change=${(event: Event) => {
                  const on = (event.target as HTMLInputElement).checked;
                  this.current[field.key] = on
                    ? [...selected, option]
                    : selected.filter((item) => item !== option);
                  this.requestUpdate();
                }}
              />
              ${option}
            </label>`;
          })}
        </span>
        ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
      </span>`;
    }
    const joined = Array.isArray(value) ? value.join(", ") : "";
    return html`<label class="form-field">
      <span class="form-label"
        >${field.label}${field.required ? " *" : ""}</span
      >
      <input
        type="text"
        .value=${joined}
        placeholder=${field.placeholder ?? "Comma-separated values"}
        @input=${(event: Event) => {
          const raw = (event.target as HTMLInputElement).value;
          this.current[field.key] = raw
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== "");
          this.requestUpdate();
        }}
      />
      ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
    </label>`;
  }

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

  private submit(): void {
    // Required fields are guaranteed present by formValid; strip empty
    // non-required values so an untouched optional field stays absent (the
    // engine's collector skips absent optionals).
    const values: Record<string, ConfigFieldFormValue> = {};
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

  private isEmpty(value: ConfigFieldFormValue): boolean {
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }
}

customElements.define("config-field-form", ConfigFieldForm);
