<script lang="ts">
import { onMount } from "svelte";
import type { FlowDefinitionDetail } from "../flow-api.ts";
import { fetchFlowDefinition } from "../flow-api.ts";
// Importing the code-editor module registers the <code-editor> element.
import type { CodeEditor } from "../flow-rendering/components/code-editor.ts";
import { themeVars } from "../shared/flow-theme.ts";
import Badge from "../shared/ui/Badge.svelte";
import Button from "../shared/ui/Button.svelte";
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

<div class="viewer" style={themeVars(detail?.theme)}>
  <div class="header-row">
    <h1>{detail?.name ?? definitionId}</h1>
    <Badge variant="neutral" outline>built-in</Badge>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {:else if loading}
    <div class="loading">loading definition...</div>
  {:else}
    <div class="tab-bar">
      <Button
        variant="neutral"
        size="small"
        class={activeTab === "definition" ? "tab-btn active" : "tab-btn"}
        onclick={() => (activeTab = "definition")}
      >
        Definition
      </Button>
      {#each filePaths as path (path)}
        <Button
          variant="neutral"
          size="small"
          class={activeTab === path ? "tab-btn active" : "tab-btn"}
          onclick={() => (activeTab = path)}
        >
          {path}
        </Button>
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

:global(.tab-btn) {
  color: var(--muted);
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
:global(.tab-btn.active),
:global(.tab-btn.active:hover) {
  color: var(--flow-on-accent, var(--on-accent));
  background: var(--flow-accent, var(--accent));
}

.pane {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
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
  font-size: var(--text-xs);
  color: var(--muted);
  letter-spacing: 0.08em;
  font-weight: 700;
}

.pane-note {
  font-size: var(--text-xs);
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
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  margin-bottom: 1rem;
}
</style>
