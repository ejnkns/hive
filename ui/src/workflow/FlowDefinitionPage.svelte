<script lang="ts">
import { onMount } from "svelte";
import type { FlowDefinitionDetail } from "../flow-api.ts";
import { fetchFlowDefinition } from "../flow-api.ts";
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

<div class="definition-page">
  {#if loading}
    <div class="loading">Loading definition...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if !definition}
    <div class="empty">Definition not found</div>
  {:else}
    <div class="header">
      <div class="header-info">
        <h1>{definition.name}</h1>
        {#if definition.builtIn}
          <Badge variant="platinum" outline>built-in</Badge>
        {/if}
        {#if definition.description}
          <div class="description">{definition.description}</div>
        {/if}
      </div>
      <div class="header-actions">
        {#if definition.builtIn}
          <Button variant="platinum">
            <a
              class="btn-link"
              href={`#/flows/${encodeURIComponent(definition.id)}/view`}
              >View</a
            >
          </Button>
        {:else}
          <Button variant="platinum">
            <a
              class="btn-link"
              href={`#/flows/${encodeURIComponent(definition.id)}/edit`}
              >Edit</a
            >
          </Button>
        {/if}
        <Button variant="mint">
          <a
            class="btn-link"
            href={`#/flows/${encodeURIComponent(definition.id)}/new`}
            >New instance</a
          >
        </Button>
      </div>
    </div>

    <div class="instances">
      <div class="section-title">Instances</div>
      <InstanceRoster
        definitionId={definition.id}
        {flows}
        onDeleted={load}
        onError={(err) => (error = err)}
      />
    </div>
  {/if}
</div>

<style>
.definition-page {
  max-width: 820px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
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
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 0.5rem 0;
}

.description {
  font-size: 0.8125rem;
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
  font-size: 0.625rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.instances {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
}

.loading,
.empty {
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
