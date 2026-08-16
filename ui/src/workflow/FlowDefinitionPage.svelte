<script lang="ts">
import { onMount } from "svelte";
import type { FlowDefinitionDetail } from "../flow-api.ts";
import { fetchFlowDefinition } from "../flow-api.ts";
import { themeVars } from "../shared/flow-theme.ts";
import Badge from "../shared/ui/Badge.svelte";
import Button from "../shared/ui/Button.svelte";
import { flowStore } from "./flow-store.svelte";
import InstanceRoster from "./InstanceRoster.svelte";

let { definitionId }: { definitionId: string } = $props();

let definition = $state<FlowDefinitionDetail | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);
let flows = $derived(
  flowStore.flows.filter((flow) => flow.config?.definitionId === definitionId)
);

onMount(() => {
  void load();
});

async function load() {
  loading = true;
  error = null;
  try {
    definition = await fetchFlowDefinition(definitionId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load definition";
  } finally {
    loading = false;
  }
}
</script>

<div class="definition-page" style={themeVars(definition?.theme)}>
  {#if loading}
    <div class="loading">loading definition...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if !definition}
    <div class="empty">definition not found</div>
  {:else}
    {@const defId = definition.id}
    <div class="header">
      <div class="header-info">
        <h1>
          {#if definition.theme?.emblem}
            <span class="flow-emblem" aria-hidden="true"
              >{definition.theme.emblem}</span
            >
          {/if}
          {definition.name}
        </h1>
        {#if definition.builtIn}
          <Badge variant="neutral" outline>built-in</Badge>
        {/if}
        {#if definition.description}
          <div class="description">{definition.description}</div>
        {/if}
      </div>
      <div class="header-actions">
        {#if definition.builtIn}
          <Button variant="neutral">
            <a
              class="btn-link"
              href={`#/flows/${encodeURIComponent(definition.id)}/view`}
              >view</a
            >
          </Button>
        {:else}
          <Button variant="neutral">
            <a
              class="btn-link"
              href={`#/flows/${encodeURIComponent(definition.id)}/edit`}
              >edit</a
            >
          </Button>
        {/if}
      </div>
    </div>

    <div class="instances">
      <div class="section-title">flow instances</div>
      <InstanceRoster definitionId={definition.id} {flows} />
    </div>
  {/if}
</div>

<style>
.definition-page {
  max-width: 820px;
  margin: 0 auto;
  padding: var(--space-6) 1.25rem;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 2rem;
}

.header-info {
  min-width: 0;
}

h1 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text);
  margin: 0 0 0.5rem 0;
}

.flow-emblem {
  font-family: var(--font-mono);
  font-size: 1.1em;
  line-height: 1;
  color: var(--flow-accent, var(--accent));
}

.description {
  font-size: var(--text-base);
  color: var(--muted);
  margin-top: 0.5rem;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.btn-link {
  text-decoration: none;
  color: inherit;
}

.section-title {
  font-size: var(--text-xs);
  color: var(--muted);
  letter-spacing: 0.08em;
  font-weight: 700;
  margin-bottom: var(--space-2);
}

/* matches the flows list: card container */
.instances {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}

.loading,
.empty {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--muted);
  font-size: var(--text-base);
}

.error {
  background: rgba(var(--error-rgb), 0.08);
  border: 1px solid rgba(var(--error-rgb), 0.3);
  color: var(--error);
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  margin-bottom: 1rem;
}
</style>
