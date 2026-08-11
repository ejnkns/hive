/** @public — the built-in flow-creation page component. */

import { css, html, LitElement, nothing } from "lit";
import { slugify } from "shared/slugify";
import {
  createFlow,
  type FlowDefinitionDetail,
  fetchFlowDefinition,
} from "../../flow-api";
import "./config-field-control";
import type { ConfigFieldValue } from "./config-field-control";

// The "new flow instance" page body: fetches the definition's configSchema,
// renders the instance-name field plus one <config-field-control> per schema
// field, and submits createFlow({ definitionId, config }) on submit. The
// route shell (Svelte) keeps the breadcrumb and navigates on
// hive-flow-created; the component owns the fetch, the local validation
// (required/empty, reserved name), and server-error display.

export class FlowCreateForm extends LitElement {
  static properties = {
    definitionId: { type: String },
  };

  static styles = css`
    .create-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .hint {
      font-size: 0.6875rem;
      color: var(--muted);
    }

    .hint.warning {
      color: var(--warning);
    }

    input[type="text"] {
      font: inherit;
      font-size: 0.75rem;
      padding: 0.375rem 0.5rem;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--surface);
      color: var(--text);
      outline: none;
    }

    input[type="text"]:focus {
      border-color: var(--accent);
    }

    input[type="text"]:disabled {
      opacity: 0.6;
    }

    .actions {
      display: flex;
      gap: 0.5rem;
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

    .loading {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--muted);
      font-size: 0.875rem;
    }

    .error {
      background: rgba(220, 60, 60, 0.1);
      border: 1px solid rgba(220, 60, 60, 0.3);
      color: #dc3c3c;
      padding: 0.75rem 1rem;
      border-radius: 6px;
      font-size: 0.8125rem;
    }
  `;

  definitionId = "";

  private definition: FlowDefinitionDetail | null = null;
  private loading = true;
  private error: string | null = null;
  private name = "";
  private values: Record<string, ConfigFieldValue | undefined> = {};
  private submitting = false;

  protected firstUpdated(): void {
    void this.loadDefinition();
  }

  private async loadDefinition(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.definition = await fetchFlowDefinition(this.definitionId);
    } catch (err) {
      this.error =
        err instanceof Error ? err.message : "Failed to load definition";
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading definition...</div>`;
    }
    if (this.definition === null) {
      return this.error !== null
        ? html`<div class="error">${this.error}</div>`
        : nothing;
    }
    return html`<form class="create-form" @submit=${this.handleSubmit}>
      <label class="field">
        <span class="label">Instance name</span>
        <input
          type="text"
          name="name"
          .value=${this.name}
          placeholder="My instance"
          ?disabled=${this.submitting}
          @input=${this.handleNameInput}
        />
        <span class="hint ${this.nameWarning !== null ? "warning" : ""}"
          >${this.nameWarning ?? "Used as the instance's URL slug."}</span
        >
      </label>

      ${this.definition.configSchema.map(
        (field) => html`<config-field-control
          .field=${field}
          .value=${this.values[field.key]}
          .disabled=${this.submitting}
          @hive-field-change=${this.handleFieldChange}
        ></config-field-control>`
      )}

      <div class="actions">
        <button
          class="primary"
          type="submit"
          ?disabled=${!this.submittable()}
        >
          ${this.submitting ? "Creating..." : "Create instance"}
        </button>
        <button
          type="button"
          ?disabled=${this.submitting}
          @click=${() => this.emitCancel()}
        >
          Cancel
        </button>
      </div>

      ${
        this.error !== null
          ? html`<div class="error">${this.error}</div>`
          : nothing
      }
    </form>`;
  }

  // "new" is a reserved flow-name slug: the route segment #/flows/new opens
  // the definition editor, so no instance may claim it.
  private get nameWarning(): string | null {
    if (this.name.trim() !== "" && slugify(this.name.trim()) === "new") {
      return '"new" is a reserved flow name';
    }
    return null;
  }

  private submittable(): boolean {
    if (this.submitting || this.name.trim() === "") return false;
    if (this.nameWarning !== null) return false;
    for (const field of this.definition?.configSchema ?? []) {
      if (!field.required) continue;
      const value = this.values[field.key];
      if (value === undefined) return false;
      if (typeof value === "string" && value.trim() === "") return false;
      if (Array.isArray(value) && value.length === 0) return false;
    }
    return true;
  }

  private handleNameInput = (event: Event): void => {
    this.name = (event.target as HTMLInputElement).value;
    this.requestUpdate();
  };

  private handleFieldChange = (
    event: CustomEvent<{ key: string; value: ConfigFieldValue | undefined }>
  ): void => {
    this.values[event.detail.key] = event.detail.value;
    this.requestUpdate();
  };

  private handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void this.submit();
  };

  private async submit(): Promise<void> {
    const definition = this.definition;
    if (definition === null || !this.submittable()) return;
    this.submitting = true;
    this.error = null;
    try {
      // Required/empty values stripped for optional fields (an untouched
      // optional field stays absent — matching the engine's collector).
      const config: Record<string, unknown> = { name: this.name.trim() };
      for (const field of definition.configSchema) {
        const value = this.values[field.key];
        if (value === undefined) continue;
        if (typeof value === "string" && value.trim() === "") continue;
        if (Array.isArray(value) && value.length === 0) continue;
        config[field.key] = value;
      }
      await createFlow({ definitionId: this.definitionId, config });
      this.dispatchEvent(
        new CustomEvent("hive-flow-created", {
          detail: {
            definitionId: this.definitionId,
            slug: slugify(this.name.trim()),
          },
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      this.error =
        err instanceof Error ? err.message : "Failed to create instance";
    } finally {
      this.submitting = false;
      this.requestUpdate();
    }
  }

  private emitCancel(): void {
    this.dispatchEvent(
      new CustomEvent("hive-flow-cancel", { bubbles: true, composed: true })
    );
  }
}

customElements.define("flow-create-form", FlowCreateForm);
