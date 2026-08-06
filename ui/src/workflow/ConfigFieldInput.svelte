<script lang="ts">
import type { ConfigField } from "workflow-engine/workflow-types";
import Select from "../shared/ui/Select.svelte";

let {
  field,
  value,
  disabled = false,
  onChange,
}: {
  field: ConfigField;
  value: string | boolean | number | undefined;
  disabled?: boolean;
  onChange: (value: string | boolean | number) => void;
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
  {:else if field.options && field.options.length > 0}
    <Select
      items={field.options.map((option) => ({ value: option, label: option }))}
      value={typeof value === "string" ? value : ""}
      onValueChange={(next) => onChange(next)}
      {disabled}
      placeholder="Select..."
      size="small"
    />
  {:else}
    <input
      class="text-input text-input-small"
      type={field.type === "number" ? "number" : "text"}
      value={String(value ?? "")}
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
</style>
