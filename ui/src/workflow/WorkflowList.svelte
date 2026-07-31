<script lang="ts">
import { onDestroy, onMount } from "svelte";
import CreateFlowForm from "./CreateFlowForm.svelte";
import type { FlowResponse, FlowWsEvent } from "./workflow-api";
import { connectFlowWs, deleteFlow, fetchFlows } from "./workflow-api";

let flows = $state<FlowResponse[]>([]);
let loading = $state(true);
let error = $state<string | null>(null);
let showCreateForm = $state(false);
let unsubWs: (() => void) | null = null;

onMount(() => {
  void loadFlows();
  unsubWs = connectFlowWs((event) => {
    handleWsEvent(event);
  });
});

onDestroy(() => {
  unsubWs?.();
});

async function loadFlows() {
  loading = true;
  error = null;
  try {
    flows = await fetchFlows();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load flows";
  } finally {
    loading = false;
  }
}

async function removeFlow(flowId: string) {
  try {
    await deleteFlow(flowId);
    await loadFlows();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to delete flow";
  }
}

function onCreateFlow(flowId: string) {
  showCreateForm = false;
  window.location.hash = `#/project/${encodeURIComponent(flowId)}`;
}

function onError(err: string) {
  error = err;
  showCreateForm = false;
}

function handleWsEvent(event: FlowWsEvent) {
  if (
    event.type === "instance_created" ||
    event.type === "instance_terminated" ||
    event.type === "instance_state_changed"
  ) {
    void loadFlows();
  }
}

function readRepoPath(flow: FlowResponse): string {
  const raw = flow.config?.repoPath;
  return typeof raw === "string" ? raw : "";
}
</script>

<div class="flows-overview">
  <div class="header">
    <h1>Flows</h1>
    <button
      type="button"
      class="btn btn-primary"
      onclick={() => (showCreateForm = true)}
    >
      New Flow
    </button>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if showCreateForm}
    <CreateFlowForm
      {onCreateFlow}
      {onError}
      onCancel={() => (showCreateForm = false)}
    />
  {/if}

  {#if loading}
    <div class="loading">Loading flows...</div>
  {:else if flows.length === 0}
    <div class="empty">
      <p>No flows yet.</p>
      <p>Create a flow to get started.</p>
    </div>
  {:else}
    <div class="flow-list">
      {#each flows as flow (flow.id)}
        <div class="flow-card">
          <div class="flow-info">
            <div class="flow-name">{flow.label}</div>
            {#if readRepoPath(flow)}
              <div class="flow-path">{readRepoPath(flow)}</div>
            {/if}
            <div class="flow-meta">
              <span class="flow-id">{flow.id}</span>
              <span class="flow-count"
                >{flow.instances.length}
                instance{flow.instances.length !== 1 ? "s" : ""}</span
              >
            </div>
          </div>
          <div class="flow-actions">
            <a
              class="btn btn-outline"
              href={`#/project/${encodeURIComponent(flow.id)}`}
            >
              Open
            </a>
            <button
              type="button"
              class="btn btn-danger"
              onclick={() => removeFlow(flow.id)}
            >
              Delete
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
.flows-overview {
  max-width: 800px;
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

.btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
  transition: background 0.15s;
}

.btn:hover {
  background: var(--border);
}

.btn-primary {
  background: var(--accent);
  color: #1b1601;
  border-color: var(--accent);
}

.btn-danger {
  background: transparent;
  border-color: rgba(220, 60, 60, 0.3);
  color: #dc3c3c;
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

.loading {
  font-size: 0.875rem;
  color: var(--muted);
  padding: 2rem 0;
  text-align: center;
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

.flow-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.flow-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
}

.flow-info {
  min-width: 0;
  flex: 1;
}

.flow-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text);
}

.flow-path {
  font-size: 0.75rem;
  color: var(--muted);
  margin-top: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-meta {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.375rem;
}

.flow-id,
.flow-count {
  font-size: 0.625rem;
  color: var(--muted);
  font-family: var(--font-mono, monospace);
}

.flow-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
  margin-left: 1rem;
}
</style>
