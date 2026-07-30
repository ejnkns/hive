<script lang="ts">
import { onDestroy, onMount } from "svelte";
import WorkflowFlow from "./WorkflowFlow.svelte";
import type { FlowResponse, FlowWsEvent } from "./workflow-api";
import {
  connectFlowWs,
  dispatchAction,
  fetchFlows,
  sendTaskInput,
} from "./workflow-api";

let flows = $state<FlowResponse[]>([]);
let loading = $state(true);
let error = $state<string | null>(null);
let unsubWs: (() => void) | null = null;

onMount(() => {
  loadFlows();
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

async function handleAction(
  flowId: string,
  instanceId: string,
  actionId: string
) {
  try {
    await dispatchAction(flowId, instanceId, actionId);
    await loadFlows();
  } catch (err) {
    error = err instanceof Error ? err.message : "Action failed";
  }
}

async function handleSendMessage(
  flowId: string,
  instanceId: string,
  content: string
) {
  await sendTaskInput(flowId, instanceId, content);
  await loadFlows();
}

function handleWsEvent(event: FlowWsEvent) {
  if (
    event.type === "instance_state_changed" ||
    event.type === "instance_terminated" ||
    event.type === "instance_created"
  ) {
    void loadFlows();
  }
}
</script>

<div class="dashboard">
  <div class="dashboard-header">
    <span class="dashboard-title">Workflows</span>
    {#if !loading}
      <button type="button" class="refresh-btn" onclick={loadFlows}>
        Refresh
      </button>
    {/if}
  </div>

  {#if loading}
    <div class="loading">Loading workflows...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if flows.length === 0}
    <div class="empty">No flows found</div>
  {:else}
    <div class="flows-list">
      {#each flows as flow (flow.id)}
        <WorkflowFlow
          flowDef={{ id: flow.id, label: flow.label }}
          flowDefs={flow.workflows}
          instances={flow.instances}
          onAction={handleAction}
          onSendMessage={handleSendMessage}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
.dashboard {
  max-width: 600px;
  margin: 0 auto;
  padding: 1.25rem;
}

.dashboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.dashboard-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.refresh-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  font-family: monospace;
  font-size: 0.625rem;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}

.refresh-btn:hover {
  color: var(--text);
  border-color: var(--accent);
}

.loading,
.empty {
  text-align: center;
  padding: 2rem;
  color: var(--muted);
  font-size: 0.8125rem;
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

.flows-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
</style>
