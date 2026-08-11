/** @public — one ConfigField rendered as a single form control. */

import { css, html, LitElement, nothing } from "lit";
import type { ConfigField } from "workflow-engine/workflow-types";

// The value type one field carries: scalar or a string[] (chips / free tags).
export type ConfigFieldValue = string | boolean | number | string[];

// A single field rendered per its ConfigField type:
//   boolean   → checkbox
//   string+options → single select
//   string[]+options → multi-select checkbox group (chips)
//   string[]  → free tag list (comma-separated)
//   textarea  → multiline text
//   date      → <input type="date"> (YYYY-MM-DD)
//   datetime  → <input type="datetime-local"> (YYYY-MM-DDTHH:mm)
//   number    → <input type="number">
//   string    → single-line text
//
// The control is controlled: `value` comes from the parent, and every edit
// emits hive-field-change with { key, value } so the parent re-gates and
// feeds the value back. Proper HTML form semantics: every control carries an
// id (cf-<key>) and name (<key>); the label links via `for` (except the chip
// group, whose chip labels wrap their own checkboxes). The multi-select chips
// are labels themselves, so the group wrapper is a span, never a label
// (labels must not nest).
//
// The control renders in light DOM (createRenderRoot returns the element):
// its inputs stay inside the parent form's shadow tree, so label-for, the
// shared submit gating, and the form's own styles all keep working. Local
// validation stays thin (required/emptiness); the server/engine collector
// (collect-config-field-values.ts) is the authority.

export class ConfigFieldControl extends LitElement {
  static properties = {
    field: { attribute: false },
    value: { attribute: false },
    disabled: { type: Boolean },
  };

  static styles = css`
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
  `;

  // Lit reactive properties need a default value; the parent always sets
  // `field` before first paint — the null cast satisfies the initializer.
  field: ConfigField = null as unknown as ConfigField;
  value: ConfigFieldValue | undefined = undefined;
  disabled = false;

  // Light DOM: the control's inputs live inside the parent form's shadow
  // tree so form semantics (label-for, submit gating) keep working.
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  render() {
    return this.renderField();
  }

  private renderField() {
    const field = this.field;
    const required = field.required ? " *" : "";
    // The field key is a valid TS identifier (spec-enforced), so it makes a
    // safe control id/name. Prefix to keep ids document-unique across forms.
    const fieldId = `cf-${field.key}`;
    if (field.type === "boolean") {
      return html`<label class="form-field">
        <span class="form-label">${field.label}</span>
        <span class="form-row">
          <input
            type="checkbox"
            id=${fieldId}
            name=${field.key}
            ?checked=${this.value === true}
            ?disabled=${this.disabled}
            @change=${(event: Event) => {
              this.emit((event.target as HTMLInputElement).checked);
            }}
          />
          ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
        </span>
      </label>`;
    }
    if (field.type === "string[]") {
      return this.renderMultiSelect(field, fieldId);
    }
    const label = html`<label class="form-label" for=${fieldId}
      >${field.label}${required}</label
    >`;
    if (field.options && field.options.length > 0) {
      return html`<span class="form-field">
        ${label}
        <select
          id=${fieldId}
          name=${field.key}
          ?disabled=${this.disabled}
          @change=${(event: Event) => {
            this.emit((event.target as HTMLSelectElement).value);
          }}
        >
          <option value="" ?selected=${this.value === undefined} disabled>
            Select...
          </option>
          ${field.options.map(
            (option) => html`<option
              value=${option}
              ?selected=${this.value === option}
            >
              ${option}
            </option>`
          )}
        </select>
        ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
      </span>`;
    }
    const placeholder = field.placeholder ?? "";
    if (field.type === "textarea") {
      // The value binds via the .value property, never as element content:
      // template whitespace between the tags would otherwise become the
      // textarea's value (a stray newline on load, and one per keystroke).
      return html`<span class="form-field">
        ${label}
        <textarea
          .value=${typeof this.value === "string" ? this.value : ""}
          id=${fieldId}
          name=${field.key}
          placeholder=${placeholder}
          ?disabled=${this.disabled}
          @input=${(event: Event) => {
            this.emit((event.target as HTMLTextAreaElement).value);
          }}
        ></textarea>
        ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
      </span>`;
    }
    if (field.type === "date") {
      return html`<span class="form-field">
        ${label}
        <input
          type="date"
          .value=${typeof this.value === "string" ? this.value : ""}
          id=${fieldId}
          name=${field.key}
          placeholder=${placeholder}
          ?disabled=${this.disabled}
          @input=${(event: Event) => {
            this.emit((event.target as HTMLInputElement).value);
          }}
        />
        ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
      </span>`;
    }
    if (field.type === "datetime") {
      return html`<span class="form-field">
        ${label}
        <input
          type="datetime-local"
          .value=${typeof this.value === "string" ? this.value : ""}
          id=${fieldId}
          name=${field.key}
          placeholder=${placeholder}
          ?disabled=${this.disabled}
          @input=${(event: Event) => {
            this.emit((event.target as HTMLInputElement).value);
          }}
        />
        ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
      </span>`;
    }
    const isNumber = field.type === "number";
    return html`<span class="form-field">
      ${label}
      <input
        type=${isNumber ? "number" : "text"}
        .value=${
          typeof this.value === "string" || typeof this.value === "number"
            ? String(this.value)
            : ""
        }
        id=${fieldId}
        name=${field.key}
        placeholder=${placeholder}
        ?disabled=${this.disabled}
        @input=${(event: Event) => {
          const input = event.target as HTMLInputElement;
          this.emit(
            isNumber
              ? input.value === ""
                ? undefined
                : Number(input.value)
              : input.value
          );
        }}
      />
      ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
    </span>`;
  }

  // A string[] field: with options a multi-select (chip/checkbox group), each
  // chosen value must be in the allowed set; without options a free tag list
  // (comma-separated text input).
  private renderMultiSelect(field: ConfigField, fieldId: string) {
    const options = field.options ?? [];
    if (options.length > 0) {
      const selected = Array.isArray(this.value) ? this.value : [];
      return html`<span class="form-field">
        <span class="form-label"
          >${field.label}${field.required ? " *" : ""}</span
        >
        <span class="form-row">
          ${options.map((option, index) => {
            const checked = selected.includes(option);
            return html`<label class="chip ${checked ? "checked" : ""}">
              <input
                type="checkbox"
                id=${`${fieldId}-${index}`}
                name=${field.key}
                ?checked=${checked}
                ?disabled=${this.disabled}
                @change=${(event: Event) => {
                  const on = (event.target as HTMLInputElement).checked;
                  this.emit(
                    on
                      ? [...selected, option]
                      : selected.filter((item) => item !== option)
                  );
                }}
              />
              ${option}
            </label>`;
          })}
        </span>
        ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
      </span>`;
    }
    const joined = Array.isArray(this.value) ? this.value.join(", ") : "";
    return html`<span class="form-field">
      <span class="form-label"
        >${field.label}${field.required ? " *" : ""}</span
      >
      <input
        type="text"
        .value=${joined}
        id=${fieldId}
        name=${field.key}
        placeholder=${field.placeholder ?? "Comma-separated values"}
        ?disabled=${this.disabled}
        @input=${(event: Event) => {
          const raw = (event.target as HTMLInputElement).value;
          this.emit(
            raw
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item !== "")
          );
        }}
      />
      ${field.hint ? html`<span class="form-hint">${field.hint}</span>` : nothing}
    </span>`;
  }

  private emit(value: ConfigFieldValue | undefined): void {
    this.dispatchEvent(
      new CustomEvent("hive-field-change", {
        detail: { key: this.field.key, value },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("config-field-control", ConfigFieldControl);
