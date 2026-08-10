<script lang="ts">
import type { ConfigField } from "workflow-engine/workflow-types";
import Select from "../shared/ui/Select.svelte";

// One ConfigField rendered as a form control, per type:
//   boolean   → checkbox
//   string+options → single select
//   string[]+options → multi-select checkbox group (chips)
//   string[]  → free tag list (comma-separated)
//   textarea  → multiline text
//   date      → <input type="date"> (YYYY-MM-DD)
//   datetime  → <input type="datetime-local"> (YYYY-MM-DDTHH:mm)
//   number    → <input type="number">
//   string    → single-line text
// Local validation stays thin (required/emptiness); the server/engine
// collector (collect-config-field-values.ts) is the format authority.

export type ConfigFieldValue = string | boolean | number | string[];

let {
  field,
  value,
  disabled = false,
  onChange,
}: {
  field: ConfigField;
  value: ConfigFieldValue | undefined;
  disabled?: boolean;
  onChange: (value: ConfigFieldValue) => void;
} = $props();
</script>

<label class="field">
  <span class="label">{field.label}{field.required ? " *" : ""}</span>
  {#if field.type === "boolean"}
    <input
      type="checkbox"
      checked={value === true}
      {disabled}
      onchange={(event) => {
        onChange(event.currentTarget.checked);
      }}
    >
  {:else if field.type === "string[]"}
    {#if field.options && field.options.length > 0}
      <span class="chips">
        {#each field.options as option (option)}
          {@const checked = Array.isArray(value) && value.includes(option)}
          <label class="chip {checked ? "checked" : ""}">
            <input
              type="checkbox"
              {checked}
              {disabled}
              onchange={(event) => {
                const current = Array.isArray(value) ? value : [];
                onChange(
                  event.currentTarget.checked
                    ? [...current, option]
                    : current.filter((item) => item !== option)
                );
              }}
            >
            {option}
          </label>
        {/each}
      </span>
    {:else}
      <input
        class="text-input text-input-small"
        type="text"
        value={Array.isArray(value) ? value.join(", ") : ""}
        placeholder={field.placeholder ?? "Comma-separated values"}
        {disabled}
        oninput={(event) => {
          onChange(
            event.currentTarget.value
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item !== "")
          );
        }}
      >
    {/if}
  {:else if field.options && field.options.length > 0}
    <Select
      items={field.options.map((option) => ({ value: option, label: option }))}
      value={typeof value === "string" ? value : ""}
      onValueChange={(next) => onChange(next)}
      {disabled}
      placeholder="Select..."
      size="small"
    />
  {:else if field.type === "textarea"}
    <textarea
      class="text-input text-input-small"
      placeholder={field.placeholder ?? ""}
      {disabled}
      oninput={(event) => {
        onChange(event.currentTarget.value);
      }}
    >
      {typeof value === "string" ? value : ""}
    </textarea>
  {:else if field.type === "date"}
    <input
      class="text-input text-input-small"
      type="date"
      value={typeof value === "string" ? value : ""}
      placeholder={field.placeholder ?? ""}
      {disabled}
      oninput={(event) => {
        onChange(event.currentTarget.value);
      }}
    >
  {:else if field.type === "datetime"}
    <input
      class="text-input text-input-small"
      type="datetime-local"
      value={typeof value === "string" ? value : ""}
      placeholder={field.placeholder ?? ""}
      {disabled}
      oninput={(event) => {
        onChange(event.currentTarget.value);
      }}
    >
  {:else}
    <input
      class="text-input text-input-small"
      type={field.type === "number" ? "number" : "text"}
      value={String(value ?? "")}
      placeholder={field.placeholder ?? ""}
      {disabled}
      oninput={(event) => {
        if (field.type === "number") {
          onChange(Number(event.currentTarget.value));
        } else {
          onChange(event.currentTarget.value);
        }
      }}
    >
  {/if}
  {#if field.hint}
    <span class="hint">{field.hint}</span>
  {/if}
</label>

<style>
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

.text-input-small {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.75rem;
}

textarea.text-input-small {
  resize: vertical;
  min-height: 4rem;
  line-height: 1.35;
  font-family: inherit;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
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
</style>
