<script lang="ts">
import { onMount } from "svelte";
import type { FlowDefinitionDetail } from "../flow-api.ts";
import { fetchFlowDefinition } from "../flow-api.ts";
// Importing the code-editor module registers the <code-editor> element.
import type { CodeEditor } from "../flow-rendering/components/code-editor.ts";
import Badge from "../shared/ui/Badge.svelte";
import "../flow-rendering/components/code-editor.ts";

let {
  definitionId,
}: {
  definitionId: string;
} = $props();

let detail = $state<FlowDefinitionDetail | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);
let activeTab = $state("definition");
let editor: CodeEditor | null = $state(null);

const filePaths = $derived(
  detail?.files ? Object.keys(detail.files).sort() : []
);

// The read-only editor shows the entry source on the Definition tab and each
// referenced module on its own tab.
const activeValue = $derived(
  activeTab === "definition"
    ? (detail?.source ?? "")
    : (detail?.files?.[activeTab] ?? "")
);

onMount(async () => {
  try {
    detail = await fetchFlowDefinition(definitionId);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load definition";
  } finally {
    loading = false;
  }
});

// The code-editor is a controlled Lit element: the view owns its value.
$effect(() => {
  if (editor !== null) editor.value = activeValue;
});
</script>

<div class="viewer">
  <div class="breadcrumb">
    <a href="#/flows">Flows</a>
    <span class="crumb-sep">/</span>
    <a href={`#/flows/${encodeURIComponent(definitionId)}`}>{definitionId}</a>
    <span class="crumb-sep">/</span>
    <span class="crumb-current">View</span>
  </div>

  <div class="header-row">
    <h1>{detail?.name ?? definitionId}</h1>
    <Badge variant="platinum" outline>built-in</Badge>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {:else if loading}
    <div class="loading">Loading definition...</div>
  {:else}
    <div class="tab-bar">
      <button
        type="button"
        class:active={activeTab === "definition"}
        onclick={() => (activeTab = "definition")}
      >
        Definition
      </button>
      {#each filePaths as path (path)}
        <button
          type="button"
          class:active={activeTab === path}
          onclick={() => (activeTab = path)}
        >
          {path}
        </button>
      {/each}
    </div>
    <div class="pane">
      <div class="pane-head">
        <span class="pane-title">
          {activeTab === "definition"
            ? "Definition source (.ts)"
            : activeTab}
        </span>
        <span class="pane-note"
          >read-only — this flow ships with the server</span
        >
      </div>
      <code-editor bind:this={editor} disabled></code-editor>
    </div>
  {/if}
</div>

<style>
.viewer {
  max-width: 1000px;
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

.header-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

h1 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.tab-bar {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.tab-bar button {
  font-family: inherit;
  font-size: 0.625rem;
  height: 24px;
  padding: 0 0.5rem;
  border-radius: 4px 4px 0 0;
  border: 1px solid var(--border);
  border-bottom: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-bar button:hover {
  color: var(--text);
}

.tab-bar button.active {
  background: var(--bg);
  color: var(--text);
  font-weight: 600;
}

.pane {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.375rem;
}

.pane-title {
  font-size: 0.5625rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
}

.pane-note {
  font-size: 0.5625rem;
  color: var(--muted);
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
