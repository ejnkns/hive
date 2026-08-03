<script lang="ts">
import { onMount } from "svelte";
import Button from "../shared/ui/Button.svelte";
import Dialog from "../shared/ui/Dialog.svelte";
import { flowStore } from "./flow-store.svelte";
import StatusDot from "./StatusDot.svelte";
import WorkflowFlow from "./WorkflowFlow.svelte";
import type { FlowLevelAction } from "./workflow-api";
import {
  deleteFlow,
  dispatchAction,
  dispatchFlowAction,
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

let flowId = $state<string | null>(null);
let resolving = $state(true);
let error = $state<string | null>(null);
let deleteOpen = $state(false);
let deleteBusy = $state(false);

let actionDialogOpen = $state(false);
let activeFlowAction = $state<FlowLevelAction | null>(null);
let actionValues = $state<Record<string, string | boolean | number>>({});
let actionBusy = $state(false);

// The flow renders from the store so every snapshot pushes live. Commands keep
// their REST calls; the resulting snapshot arrives over WS (no refetch).
const flow = $derived(flowId ? flowStore.getFlow(flowId) : null);

onMount(() => {
  void resolveFlowId();
});

async function resolveFlowId() {
  resolving = true;
  error = null;
  const fromStore = flowStore.findFlow(definitionId, instanceName);
  if (fromStore) {
    flowId = fromStore.id;
    resolving = false;
    return;
  }
  // The store may not be hydrated yet (init not received) — fall back to one
  // REST read and seed the store. The next init/snapshot overwrites it.
  try {
    const matches = await fetchFlows({ definitionId, name: instanceName });
    const matched = matches[0] ?? null;
    if (matched) {
      flowStore.upsert(matched);
      flowId = matched.id;
    } else {
      flowId = null;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load flow";
  } finally {
    resolving = false;
  }
}

async function handleAction(
  flowId: string,
  instanceId: string,
  actionId: string
) {
  try {
    await dispatchAction(flowId, instanceId, actionId);
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
}

async function removeInstance(purge: boolean) {
  if (!flow) return;
  deleteBusy = true;
  error = null;
  try {
    await deleteFlow(flow.id, purge);
    flowStore.removeFlow(flow.id);
    window.location.hash = `#/flows/${encodeURIComponent(definitionId)}`;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to delete flow";
  } finally {
    deleteBusy = false;
    deleteOpen = false;
  }
}

function actionVariant(action: FlowLevelAction): string {
  switch (action.variant) {
    case "primary":
      return "mint";
    case "destructive":
      return "rose";
    default:
      return "platinum";
  }
}

function runFlowAction(action: FlowLevelAction) {
  if (action.createInstance) {
    activeFlowAction = action;
    actionValues = {};
    actionDialogOpen = true;
    return;
  }
  void executeFlowAction(action, {});
}

async function executeFlowAction(
  action: FlowLevelAction,
  payload: Record<string, unknown>
) {
  if (!flow) return;
  actionBusy = true;
  error = null;
  try {
    await dispatchFlowAction(flow.id, action.id, payload);
  } catch (err) {
    error = err instanceof Error ? err.message : "Flow action failed";
  } finally {
    actionBusy = false;
  }
}

function missingRequiredActionField(): boolean {
  const fields = activeFlowAction?.createInstance?.fields ?? [];
  return fields.some((field) => {
    if (!field.required) return false;
    const value = actionValues[field.key];
    return value === undefined || value === "";
  });
}

function submitFlowActionForm() {
  const action = activeFlowAction;
  if (!action) return;
  actionDialogOpen = false;
  activeFlowAction = null;
  void executeFlowAction(action, { ...actionValues });
}
</script>

<div class="instance-page">
  {#if resolving}
    <div class="loading">Loading instance...</div>
  {:else if error}
    <div class="error">{error}</div>
    <button type="button" class="retry-btn" onclick={resolveFlowId}>
      Retry
    </button>
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
      {#if flow.availableFlowActions.length > 0}
        <div class="flow-actions">
          {#each flow.availableFlowActions as action}
            <Button
              variant={actionVariant(action) as "mint" | "rose" | "platinum"}
              size="small"
              disabled={actionBusy}
              onclick={() => runFlowAction(action)}
            >
              {action.label}
            </Button>
          {/each}
        </div>
      {/if}
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

<Dialog
  bind:open={actionDialogOpen}
  label={activeFlowAction?.label ?? "Flow action"}
  contentMaxWidth="420px"
>
  {#if activeFlowAction?.createInstance}
    <h2 class="dialog-title">{activeFlowAction.label}</h2>
    <div class="action-form">
      {#each activeFlowAction.createInstance.fields as field (field.key)}
        <label class="field">
          <span class="label">{field.label}{field.required ? " *" : ""}</span>
          {#if field.type === "boolean"}
            <input
              type="checkbox"
              checked={actionValues[field.key] === true}
              onchange={(event) => {
                actionValues[field.key] = event.currentTarget.checked;
              }}
            >
          {:else}
            <input
              class="text-input text-input-small"
              type={field.type === "number" ? "number" : "text"}
              value={String(actionValues[field.key] ?? "")}
              oninput={(event) => {
                if (field.type === "number") {
                  actionValues[field.key] = Number(event.currentTarget.value);
                } else {
                  actionValues[field.key] = event.currentTarget.value;
                }
              }}
            >
          {/if}
          {#if field.hint}
            <span class="hint">{field.hint}</span>
          {/if}
        </label>
      {/each}
    </div>
    <div class="dialog-actions">
      <Button
        variant="mint"
        disabled={missingRequiredActionField()}
        onclick={submitFlowActionForm}
      >
        Run
      </Button>
      <Button
        variant="platinum"
        onclick={() => {
          actionDialogOpen = false;
          activeFlowAction = null;
        }}
      >
        Cancel
      </Button>
    </div>
  {/if}
</Dialog>

<Dialog bind:open={deleteOpen} label="Delete instance" contentMaxWidth="420px">
  <h2 class="dialog-title">Delete instance</h2>
  <p class="dialog-text">
    "Delete instance" removes Hive's operational state. "Delete instance and its
    data" also removes the flow's persisted domain state in the repository and
    cannot be undone.
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

.flow-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.75rem;
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

.dialog-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.action-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.hint {
  font-size: 0.6875rem;
  color: var(--muted);
}

.text-input-small {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.75rem;
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
