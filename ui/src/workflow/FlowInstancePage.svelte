<script lang="ts">
import { onMount } from "svelte";
import type { FlowLevelAction } from "../flow-api.ts";
import {
  deleteFlow,
  dispatchAction,
  dispatchFlowAction,
  fetchFlows,
  patchInstanceState,
  sendTaskInput,
} from "../flow-api.ts";
import type { ConfigFieldForm } from "../flow-rendering/components/config-field-form.ts";
import { themeVars } from "../shared/flow-theme.ts";
import Button from "../shared/ui/Button.svelte";
import Dialog from "../shared/ui/Dialog.svelte";
import { flowStore } from "./flow-store.svelte";
import LitFlowHost from "./LitFlowHost.svelte";
import StatusDot from "./StatusDot.svelte";

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
let actionForm = $state<ConfigFieldForm | null>(null);

// The dialog body is <config-field-form> (the shared Lit form); the element's
// props are set imperatively — Svelte must not bind object props onto custom
// elements (the LitFlowHost pattern).
$effect(() => {
  if (!actionForm) return;
  actionForm.fields = activeFlowAction?.createInstance?.fields ?? [];
  actionForm.submitLabel = "Run";
});

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
  actionId: string,
  payload?: Record<string, unknown>
) {
  try {
    await dispatchAction(flowId, instanceId, actionId, payload);
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

async function handlePatchState(
  flowId: string,
  instanceId: string,
  values: Record<string, unknown>
) {
  try {
    await patchInstanceState(flowId, instanceId, values);
  } catch (err) {
    error = err instanceof Error ? err.message : "State patch failed";
  }
}

// A custom workflow view asked the shell to open a workflow instance. The
// flow-instance page IS the workflow-instance surface today; a dedicated
// per-instance detail page is future work (the plan's flow-level custom
// component), so the route is a no-op that keeps the seam.
function handleSelect(_flowId: string, _instanceId: string): void {
  // no dedicated workflow-instance page yet
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

async function executeFlowAction(
  action: FlowLevelAction,
  payload: Record<string, unknown>
) {
  if (!flow) return;
  error = null;
  try {
    await dispatchFlowAction(flow.id, action.id, payload);
  } catch (err) {
    error = err instanceof Error ? err.message : "Flow action failed";
  }
}

// The Lit flow-actions bar signalled a createInstance action: open the shared
// create-form dialog for that action.
function handleCreate(_flowId: string, actionId: string) {
  const action = flow?.availableFlowActions.find((a) => a.id === actionId);
  if (action?.createInstance === undefined) return;
  activeFlowAction = action;
  actionDialogOpen = true;
}

// The Lit flow-actions bar signalled a non-create action: dispatch it.
function handleFlowAction(_flowId: string, actionId: string) {
  const action = flow?.availableFlowActions.find((a) => a.id === actionId);
  if (action === undefined) return;
  void executeFlowAction(action, {});
}

function submitFlowActionForm(
  event: CustomEvent<{ values: Record<string, unknown> }>
) {
  const action = activeFlowAction;
  if (!action) return;
  actionDialogOpen = false;
  activeFlowAction = null;
  void executeFlowAction(action, event.detail.values);
}

function closeFlowActionForm() {
  actionDialogOpen = false;
  activeFlowAction = null;
}
</script>

<div class="instance-page" style={themeVars(flow?.ui?.theme)}>
  {#if resolving}
    <div class="loading">loading instance...</div>
  {:else if error}
    <div class="error">{error}</div>
    <Button variant="neutral" class="retry-btn" onclick={resolveFlowId}>
      Retry
    </Button>
  {:else if !flow}
    <div class="empty">Instance not found</div>
  {:else}
    <div class="instance-header">
      <div class="header-row">
        <span class="status-group">
          <StatusDot status={flow.status} />
          <span class="status-text">{flow.status}</span>
        </span>
        <Button
          variant="neutral"
          size="small"
          onclick={() => (deleteOpen = true)}
        >
          manage
        </Button>
      </div>
    </div>

    <div class="flow-sections">
      <LitFlowHost
        flowId={flow.id}
        flow={{ id: flow.id, label: flow.label, status: flow.status, config: flow.config ?? {} }}
        flowComponent={flow.ui?.flowComponent}
        workflowDefs={flow.workflows}
        instances={flow.instances}
        customKinds={flow.ui?.kinds ?? []}
        components={flow.ui?.components ?? {}}
        availableFlowActions={flow.availableFlowActions}
        persistedOutputs={flow.ui?.persistedOutputs ?? {}}
        persistedOutputDirs={flow.ui?.persistedOutputDirs ?? {}}
        onAction={handleAction}
        onSendMessage={handleSendMessage}
        onPatchState={handlePatchState}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onFlowAction={handleFlowAction}
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
    <!-- The wrapper classes keep the queen-bee e2e's shadow-piercing
         selectors (.action-form input, .dialog-actions button) working. -->
    <div class="dialog-actions">
      <div class="action-form">
        <config-field-form
          bind:this={actionForm}
          onhive-fields-submit={submitFlowActionForm}
          onhive-fields-cancel={closeFlowActionForm}
        ></config-field-form>
      </div>
    </div>
  {/if}
</Dialog>

<Dialog
  bind:open={deleteOpen}
  label="delete flow instance"
  contentMaxWidth="420px"
>
  <h2 class="dialog-title">delete flow instance</h2>
  <p class="dialog-text">
    "delete flow instance" removes Hive's operational state. "delete flow
    instance and its data" also removes the flow's persisted domain state in the
    repository and cannot be undone.
  </p>
  <div class="dialog-actions">
    <Button
      variant="neutral"
      disabled={deleteBusy}
      onclick={() => removeInstance(false)}
    >
      delete flow instance
    </Button>
    <Button
      variant="danger"
      disabled={deleteBusy}
      onclick={() => removeInstance(true)}
    >
      delete flow instance and its data
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

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-group {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.status-text {
  font-size: var(--text-xs);
  color: var(--muted);
  text-transform: capitalize;
}

.dialog-title {
  margin: 0 0 0.75rem 0;
  font-size: var(--text-sm);
  font-weight: 700;
}

.dialog-text {
  font-size: var(--text-base);
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
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  margin-bottom: 1rem;
}

:global(.retry-btn) {
  display: block;
  margin: 1rem auto;
  padding: 0.5rem 1rem;
}
</style>
