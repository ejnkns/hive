<script lang="ts">
import { slugify } from "shared/slugify";
import { onMount } from "svelte";
import Button from "../shared/ui/Button.svelte";
import TextInput from "../shared/ui/TextInput.svelte";
import ConfigFieldInput from "./ConfigFieldInput.svelte";
import type { FlowDefinitionDetail } from "./flow-api";
import { createFlow, fetchFlowDefinition } from "./flow-api";

let { definitionId }: { definitionId: string } = $props();

let definition = $state<FlowDefinitionDetail | null>(null);
let name = $state("");
let values = $state<Record<string, string | boolean | number>>({});
let loading = $state(true);
let error = $state<string | null>(null);
let submitting = $state(false);

let nameWarning = $derived.by(() => {
  if (name.trim() !== "" && slugify(name.trim()) === "new") {
    return '"new" is a reserved flow name';
  }
  return null;
});

onMount(async () => {
  try {
    definition = await fetchFlowDefinition(definitionId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load definition";
  } finally {
    loading = false;
  }
});

function missingRequired(): string | null {
  if (!name.trim()) return "Instance name is required";
  for (const field of definition?.configSchema ?? []) {
    if (field.required) {
      const value = values[field.key];
      if (value === undefined || value === "") {
        return `Field "${field.label}" is required`;
      }
    }
  }
  return null;
}

async function submit() {
  if (!definition) return;
  const missing = missingRequired();
  if (missing) {
    error = missing;
    return;
  }

  submitting = true;
  error = null;
  if (nameWarning) {
    error = nameWarning;
    submitting = false;
    return;
  }
  try {
    const config: Record<string, unknown> = { name: name.trim() };
    for (const field of definition.configSchema) {
      const value = values[field.key];
      if (value !== undefined && value !== "") {
        config[field.key] = value;
      }
    }
    await createFlow({ definitionId, config });
    const slug = slugify(name.trim());
    window.location.hash = `#/flows/${encodeURIComponent(definitionId)}/${encodeURIComponent(slug)}`;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to create instance";
  } finally {
    submitting = false;
  }
}
</script>

<div class="instantiate">
  <div class="breadcrumb">
    <a href="#/flows">Flows</a>
    <span class="crumb-sep">/</span>
    <a href={`#/flows/${encodeURIComponent(definitionId)}`}>{definitionId}</a>
    <span class="crumb-sep">/</span>
    <span class="crumb-current">New instance</span>
  </div>

  <h1>New instance</h1>

  {#if loading}
    <div class="loading">Loading definition...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if definition}
    <form
      class="form"
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label class="field">
        <span class="label">Instance name</span>
        <TextInput
          bind:value={name}
          placeholder="My instance"
          disabled={submitting}
        />
        <span class="hint"
          >{nameWarning ?? "Used as the instance's URL slug."}</span
        >
      </label>

      {#each definition.configSchema as field (field.key)}
        <ConfigFieldInput
          {field}
          value={values[field.key]}
          disabled={submitting}
          onChange={(value) => {
            values[field.key] = value;
          }}
        />
      {/each}

      <div class="actions">
        <Button
          variant="mint"
          type="submit"
          disabled={submitting || !name.trim()}
        >
          {submitting ? "Creating..." : "Create instance"}
        </Button>
        <Button
          variant="platinum"
          type="button"
          disabled={submitting}
          onclick={() => (window.location.hash = `#/flows/${encodeURIComponent(definitionId)}`)}
        >
          Cancel
        </Button>
      </div>
    </form>
  {/if}
</div>

<style>
.instantiate {
  max-width: 520px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  color: var(--muted);
  margin-bottom: 0.5rem;
}

.breadcrumb a {
  color: var(--muted);
  text-decoration: none;
}

.breadcrumb a:hover {
  color: var(--text);
}

.crumb-sep {
  opacity: 0.5;
}

.crumb-current {
  color: var(--text);
}

h1 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 1.5rem 0;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
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
  margin-bottom: 1rem;
}
</style>
