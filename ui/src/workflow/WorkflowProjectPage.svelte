<script lang="ts">
import { onDestroy, onMount } from "svelte";
import {
  closePanel,
  projectHeader,
} from "../queen-bee/project-header-state.svelte";
import WorkflowFlow from "./WorkflowFlow.svelte";
import {
  connectFlowWs,
  dispatchAction,
  type FlowResponse,
  type FlowWsEvent,
  fetchFlows,
  sendTaskInput,
} from "./workflow-api";

let { projectId }: { projectId: string } = $props();

let flows = $state<FlowResponse[]>([]);
let loading = $state(true);
let error = $state<string | null>(null);
let unsubWs: (() => void) | null = null;

onMount(() => {
  projectHeader.projectId = projectId;
  loadFlows();
  unsubWs = connectFlowWs((event) => {
    handleWsEvent(event);
  });
  return () => {
    unsubWs?.();
    closePanel();
  };
});

async function loadFlows() {
  loading = true;
  error = null;
  try {
    flows = await fetchFlows();
    const reqFlow = flows.find((f) => f.id === projectId);
    if (reqFlow) {
      const reqInstance = reqFlow.instances.find(
        (i) => i.workflowId === "requirements"
      );
      const taskOutputs = reqInstance?.state?.taskOutputs;
      draftContent =
        ((
          (taskOutputs?.draft as Record<string, unknown>)?.output as Record<
            string,
            unknown
          >
        )?.content as string) ?? "";
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load flows";
  } finally {
    loading = false;
  }
}

let draftContent = $state("");

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

let currentFlow = $derived(flows.find((f) => f.id === projectId) ?? null);
</script>

<div class="project-page">
  {#if loading}
    <div class="loading">Loading project...</div>
  {:else if error}
    <div class="error">{error}</div>
    <button type="button" class="retry-btn" onclick={loadFlows}>Retry</button>
  {:else if !currentFlow}
    <div class="empty">Project not found</div>
  {:else}
    <div class="flow-sections">
      <WorkflowFlow
        flowDef={{ id: currentFlow.id, label: currentFlow.label }}
        flowDefs={currentFlow.workflows}
        instances={currentFlow.instances}
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
