<script lang="ts">
import { onMount } from "svelte";
import Badge from "../shared/ui/Badge.svelte";
import Button from "../shared/ui/Button.svelte";
import Skeleton from "../shared/ui/Skeleton.svelte";
import TextInput from "../shared/ui/TextInput.svelte";
import type { FlowDefinitionSummary } from "./flow-api";
import { fetchFlowDefinitions } from "./flow-api";
import { flowStore } from "./flow-store.svelte";
import InstanceRoster from "./InstanceRoster.svelte";

let definitions = $state<FlowDefinitionSummary[]>([]);
let loading = $state(true);
let error = $state<string | null>(null);
let search = $state("");
let filter = $state<"all" | "builtin" | "user">("all");
let flows = $derived(flowStore.flows.filter((flow) => !flow.hidden));

const visibleDefinitions = $derived(
  definitions.filter((definition) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      query === "" ||
      definition.name.toLowerCase().includes(query) ||
      (definition.description ?? "").toLowerCase().includes(query);
    const matchesFilter =
      filter === "all" ||
      (filter === "builtin" && definition.builtIn) ||
      (filter === "user" && !definition.builtIn);
    return matchesSearch && matchesFilter;
  })
);

onMount(() => {
  void load();
});

async function load() {
  loading = true;
  error = null;
  try {
    definitions = await fetchFlowDefinitions();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load flows";
  } finally {
    loading = false;
  }
}

function instancesFor(definitionId: string) {
  return flows.filter((flow) => flow.config?.definitionId === definitionId);
}

function definitionHref(id: string): string {
  return `#/flows/${encodeURIComponent(id)}`;
}
</script>

<div class="library">
  <div class="header">
    <h1>Flows</h1>
    <a class="btn-new" href="#/flows/new">New flow definition</a>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="status-legend">
    <span class="legend-title">Instance status</span>
    <span class="legend-item"><i class="dot dot-running"></i>running</span>
    <span class="legend-item"><i class="dot dot-waiting"></i>waiting</span>
    <span class="legend-item"><i class="dot dot-error"></i>error</span>
    <span class="legend-item"><i class="dot dot-idle"></i>idle</span>
    <span class="legend-item"><i class="dot dot-complete"></i>complete</span>
  </div>

  <div class="toolbar">
    <TextInput
      bind:value={search}
      placeholder="Search definitions..."
      size="small"
    />
    <div class="filter-group" role="group" aria-label="Filter definitions">
      <button
        type="button"
        class:active={filter === "all"}
        onclick={() => (filter = "all")}
      >
        All
      </button>
      <button
        type="button"
        class:active={filter === "builtin"}
        onclick={() => (filter = "builtin")}
      >
        Built-in
      </button>
      <button
        type="button"
        class:active={filter === "user"}
        onclick={() => (filter = "user")}
      >
        User
      </button>
    </div>
  </div>

  {#if loading}
    <div class="definition-list">
      {#each [1, 2] as n (n)}
        <div class="definition-card">
          <Skeleton shape="line" style="width: 40%" />
          <Skeleton shape="line" style="width: 70%" />
        </div>
      {/each}
    </div>
  {:else if definitions.length === 0}
    <div class="empty">
      <p>No flow definitions yet.</p>
      <p>Author a definition to get started.</p>
    </div>
  {:else if visibleDefinitions.length === 0}
    <div class="empty">
      <p>No definitions match your search.</p>
    </div>
  {:else}
    <div class="definition-list">
      {#each visibleDefinitions as definition (definition.id)}
        <div class="definition-card">
          <div class="definition-head">
            <a class="definition-name" href={definitionHref(definition.id)}>
              {definition.name}
            </a>
            {#if definition.builtIn}
              <Badge variant="platinum" outline>built-in</Badge>
            {/if}
            <span class="definition-count"
              >{instancesFor(definition.id).length}
              instance{instancesFor(definition.id).length !== 1 ? "s" : ""}</span
            >
          </div>
          {#if definition.description}
            <div class="definition-description">{definition.description}</div>
          {/if}
          <div class="definition-actions">
            <Button variant="platinum">
              <a class="btn-link" href={definitionHref(definition.id)}>Open</a>
            </Button>
            <Button variant="mint">
              <a class="btn-link" href={`${definitionHref(definition.id)}/new`}
                >New instance</a
              >
            </Button>
          </div>
          <div class="definition-instances">
            <InstanceRoster
              definitionId={definition.id}
              flows={instancesFor(definition.id)}
              onDeleted={load}
              onError={(err) => (error = err)}
            />
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
.library {
  max-width: 820px;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

h1 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.btn-new {
  text-decoration: none;
  font-family: monospace;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 6px 10px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--bg);
  background: var(--accent);
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

.empty {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--muted);
  font-size: 0.875rem;
}

.empty p {
  margin: 0.25rem 0;
}

.definition-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.definition-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
}

.definition-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.definition-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
}

.definition-name:hover {
  color: var(--accent);
}

.definition-count {
  margin-left: auto;
  font-size: 0.625rem;
  color: var(--muted);
  font-family: var(--font-mono, monospace);
}

.definition-description {
  font-size: 0.75rem;
  color: var(--muted);
  margin-top: 0.25rem;
}

.definition-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.btn-link {
  text-decoration: none;
  color: inherit;
}

.status-legend {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  font-size: 0.625rem;
  color: var(--muted);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.toolbar :global(.text-input-small) {
  max-width: 320px;
}

.filter-group {
  display: flex;
  gap: 0.25rem;
}

.filter-group button {
  font-family: monospace;
  font-size: 0.625rem;
  height: 28px;
  padding: 0 0.625rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
}

.filter-group button:hover {
  border-color: var(--accent);
}

.filter-group button.active {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}

.legend-title {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.dot-running {
  background: var(--accent);
}

.dot-waiting {
  background: var(--warning);
}

.dot-error {
  background: var(--error);
}

.dot-idle {
  background: var(--muted);
}

.dot-complete {
  background: var(--success);
}
</style>
