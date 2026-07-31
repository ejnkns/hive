<script lang="ts">
import { onDestroy, onMount } from "svelte";
import WorkflowFlow from "./WorkflowFlow.svelte";
import {
  connectFlowWs,
  dispatchAction,
  type FlowResponse,
  type FlowWsEvent,
  fetchFlow,
  sendTaskInput,
} from "./workflow-api";

let { projectId }: { projectId: string } = $props();

let flow = $state<FlowResponse | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);
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
    flow = await fetchFlow(projectId);
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
</script>

<div class="project-page">
  {#if loading}
    <div class="loading">Loading project...</div>
  {:else if error}
    <div class="error">{error}</div>
    <button type="button" class="retry-btn" onclick={loadFlow}>Retry</button>
  {:else if !flow}
    <div class="empty">Project not found</div>
  {:else}
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

<style>
.project-page {
  max-width: 600px;
  margin: 0 auto;
  padding: 0.75rem 1.25rem;
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

.flow-sections {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
