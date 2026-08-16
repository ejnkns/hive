<script lang="ts">
import { comb } from "shared/ascii-art";
import { onMount } from "svelte";
import type { FlowDefinitionSummary } from "../flow-api.ts";
import { fetchFlowDefinitions } from "../flow-api.ts";
import Button from "../shared/ui/Button.svelte";
import Skeleton from "../shared/ui/Skeleton.svelte";
import TextInput from "../shared/ui/TextInput.svelte";
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
    <h1>flows</h1>
    <Button variant="accent" size="default">
      <a class="btn-link" href="#/flows/new">new definition</a>
    </Button>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="toolbar">
    <TextInput
      bind:value={search}
      placeholder="Search definitions..."
      size="small"
    />
    <div class="filter-group" role="group" aria-label="Filter definitions">
      <Button
        variant="neutral"
        size="small"
        class={filter === "all" ? "filter-btn active" : "filter-btn"}
        onclick={() => (filter = "all")}
      >
        all
      </Button>
      <Button
        variant="neutral"
        size="small"
        class={filter === "builtin" ? "filter-btn active" : "filter-btn"}
        onclick={() => (filter = "builtin")}
      >
        built-in
      </Button>
      <Button
        variant="neutral"
        size="small"
        class={filter === "user" ? "filter-btn active" : "filter-btn"}
        onclick={() => (filter = "user")}
      >
        user
      </Button>
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
      <pre class="empty-comb" aria-hidden="true">{comb}</pre>
      <p>no flow definitions yet.</p>
      <p class="empty-hint">author a definition to get started.</p>
      <div class="empty-action">
        <Button variant="accent">
          <a class="btn-link" href="#/flows/new">new definition</a>
        </Button>
      </div>
    </div>
  {:else if visibleDefinitions.length === 0}
    <div class="empty">
      <p>no definitions match your search.</p>
      <p class="empty-hint">try a different query or clear the filter.</p>
    </div>
  {:else}
    <div class="definition-list">
      {#each visibleDefinitions as definition (definition.id)}
        <div class="definition-card">
          <a
            class="card-link"
            href={definitionHref(definition.id)}
            aria-label={`open ${definition.name}`}
          ></a>
          <div class="definition-head">
            <a
              class="head-link"
              href={definitionHref(definition.id)}
              aria-label={`open ${definition.name}`}
            >
              <div class="definition-head-info">
                <span class="definition-name">{definition.name}</span>
                {#if definition.description}
                  <span class="definition-description"
                    >{definition.description}</span
                  >
                {/if}
              </div>
            </a>
          </div>
          <InstanceRoster
            definitionId={definition.id}
            flows={instancesFor(definition.id)}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
.library {
  max-width: 820px;
  margin: 0 auto;
  padding: var(--space-6) 1.25rem;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

h1 {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.btn-link {
  text-decoration: none;
  color: inherit;
}

.error {
  background: rgba(var(--error-rgb), 0.08);
  border: 1px solid rgba(var(--error-rgb), 0.3);
  color: var(--error);
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  margin-bottom: 1rem;
}

.empty {
  text-align: center;
  padding: var(--space-6) 1rem;
  color: var(--muted);
  font-size: var(--text-sm);
}

.empty-comb {
  font-family: var(--font-mono);
  font-size: clamp(0.375rem, 1.1vw, 0.5625rem);
  line-height: 1.35;
  color: var(--brand);
  margin: 0 0 var(--space-4);
  opacity: 0.55;
}

.empty p {
  margin: 0.25rem 0;
}

.empty-hint {
  color: var(--muted);
  font-size: var(--text-xs);
}

.empty-action {
  margin-top: var(--space-4);
}

.definition-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.definition-card {
  position: relative;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  transition: border-color var(--dur-fast) var(--ease-out);
}
.definition-card:hover {
  border-color: color-mix(in srgb, var(--border) 60%, var(--accent));
}

/* the head (name + description + trailing space) is the definition link;
   the roster below is plain flow — no overlay, nothing can intercept */
.definition-head {
  display: flex;
}
.head-link {
  display: flex;
  flex: 1;
  min-width: 0;
  text-decoration: none;
}
.definition-head-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.definition-name {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--text);
  transition: color var(--dur-fast) var(--ease-out);
}
.definition-card:hover .definition-name {
  color: var(--accent);
}

.definition-description {
  font-size: var(--text-sm);
  color: var(--muted);
}

.definition-card :global(.roster) {
  margin-top: var(--space-3);
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

:global(.filter-btn.active),
:global(.filter-btn.active:hover) {
  color: var(--on-accent);
  background: var(--accent);
}
</style>
