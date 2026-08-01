<script lang="ts">
import { onDestroy, onMount } from "svelte";
import Button from "../shared/ui/Button.svelte";
import Dialog from "../shared/ui/Dialog.svelte";
import StatusDot from "./StatusDot.svelte";
import WorkflowFlow from "./WorkflowFlow.svelte";
import type { FlowResponse, FlowWsEvent } from "./workflow-api";
import {
  connectFlowWs,
  deleteFlow,
  dispatchAction,
  fetchFlows,
  sendTaskInput,
} from "./workflow-api";

let {
  definitionId,
  instanceName,
}: {
  definitionId: string;
  instanceName: string;
} = $props();

let flow = $state<FlowResponse | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);
let deleteOpen = $state(false);
let deleteBusy = $state(false);
let unsubWs: (() => void) | null = null;

onMount(() => {
  void loadFlow();
  unsubWs = connectFlowWs((event) => {
    handleWsEvent(event);
  });
  return () => {
    unsubWs?.();
  };
});

async function loadFlow() {
  loading = true;
  error = null;
  try {
    const matches = await fetchFlows({ definitionId, name: instanceName });
    flow = matches[0] ?? null;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load flow";
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
    await loadFlow();
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
  await loadFlow();
}

function handleWsEvent(event: FlowWsEvent) {
  if (
    event.type === "instance_state_changed" ||
    event.type === "instance_terminated" ||
    event.type === "instance_created"
  ) {
    void loadFlow();
  }
}

async function removeInstance(purge: boolean) {
  if (!flow) return;
  deleteBusy = true;
  error = null;
  try {
    await deleteFlow(flow.id, purge);
    window.location.hash = `#/flows/${encodeURIComponent(definitionId)}`;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to delete flow";
  } finally {
    deleteBusy = false;
    deleteOpen = false;
  }
}
</script>

<div class="instance-page">
  {#if loading}
    <div class="loading">Loading instance...</div>
  {:else if error}
    <div class="error">{error}</div>
    <button type="button" class="retry-btn" onclick={loadFlow}>Retry</button>
  {:else if !flow}
    <div class="empty">Instance not found</div>
  {:else}
    <div class="instance-header">
      <div class="breadcrumb">
        <a href="#/flows">Flows</a>
        <span class="crumb-sep">/</span>
        <a href={`#/flows/${encodeURIComponent(definitionId)}`}
          >{definitionId}</a
        >
        <span class="crumb-sep">/</span>
        <span class="crumb-current">{flow.config?.name ?? flow.id}</span>
      </div>
      <div class="header-row">
        <h1>
          <StatusDot status={flow.status} />
          {flow.config?.name ?? flow.id}
        </h1>
        <Button variant="rose" onclick={() => (deleteOpen = true)}>
          Delete
        </Button>
      </div>
    </div>

    <div class="flow-sections">
      <WorkflowFlow
        flowDef={{ id: flow.id, label: flow.label }}
        flowDefs={flow.workflows}
        instances={flow.instances}
        onAction={handleAction}
        onSendMessage={handleSendMessage}
      />
    </div>
  {/if}
</div>

<Dialog bind:open={deleteOpen} label="Delete instance" contentMaxWidth="420px">
  <h2 class="dialog-title">Delete instance</h2>
  <p class="dialog-text">
    "Delete instance" removes Hive's operational state. "Delete instance and its
    data" also removes the <code>basePath/.hive</code> directory and cannot be
    undone.
  </p>
  <div class="dialog-actions">
    <Button
      variant="platinum"
      disabled={deleteBusy}
      onclick={() => removeInstance(false)}
    >
      Delete instance
    </Button>
    <Button
      variant="rose"
      disabled={deleteBusy}
      onclick={() => removeInstance(true)}
    >
      Delete instance and its data
    </Button>
  </div>
</Dialog>

<style>
.instance-page {
  max-width: 820px;
  margin: 0 auto;
  padding: 1.25rem;
}

.instance-header {
  margin-bottom: 1rem;
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
  justify-content: space-between;
}

h1 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.dialog-title {
  margin: 0 0 0.75rem 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.dialog-text {
  font-size: 0.8125rem;
  color: var(--muted);
  line-height: 1.5;
  margin: 0 0 1rem 0;
}

.dialog-text code {
  font-size: 0.75rem;
}

.dialog-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.flow-sections {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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

.retry-btn {
  display: block;
  margin: 1rem auto;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  font-family: monospace;
  font-size: 0.75rem;
  cursor: pointer;
}

.retry-btn:hover {
  background: var(--border);
}
</style>
