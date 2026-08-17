<script lang="ts">
import { untrack } from "svelte";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { CustomRenderKind } from "workflow-engine/workflow-types";
import type { FlowLevelAction } from "../flow-api.ts";
import { loadFlowComponents } from "../flow-rendering/load-flow-components.ts";
import type { WorkflowInstances } from "../flow-rendering.ts";

// The Svelte adapter for the Lit rendering surface: forwards the flow's
// workflow definitions and instances to the workflow-instances element,
// loads the flow's served-at-runtime components into the renderer registry,
// and forwards action/message events back as callbacks. The app shell stays
// Svelte; everything below this element is Lit + Web Components.

let {
  flowId,
  workflowDefs,
  instances,
  customKinds,
  components,
  availableFlowActions,
  onAction,
  onSendMessage,
  onPatchState,
  onSelect,
  onCreate,
  onFlowAction,
}: {
  flowId: string;
  workflowDefs: WorkflowDefResponse[];
  instances: WorkflowInstanceEntry[];
  customKinds: readonly CustomRenderKind[];
  // Served component ids → fetch path, from the flow snapshot's ui.components.
  components: Record<string, string>;
  availableFlowActions?: FlowLevelAction[];
  onAction?: (
    flowId: string,
    instanceId: string,
    actionId: string,
    payload?: Record<string, unknown>
  ) => void;
  onSendMessage?: (
    flowId: string,
    instanceId: string,
    content: string
  ) => Promise<void>;
  onPatchState?: (
    flowId: string,
    instanceId: string,
    values: Record<string, unknown>
  ) => void;
  // A custom workflow view asked the shell to open the workflow-instance page.
  onSelect?: (flowId: string, instanceId: string) => void;
  // A flow-level createInstance action asked the shell to open the create form.
  onCreate?: (flowId: string, actionId: string) => void;
  // A flow-level action (non-create) asked the shell to dispatch it.
  onFlowAction?: (flowId: string, actionId: string) => void;
} = $props();

let host: WorkflowInstances | null = null;

$effect(() => {
  if (!host) return;
  host.flowId = flowId;
  host.workflowDefs = workflowDefs;
  host.instances = instances;
  host.customKinds = customKinds;
  host.availableFlowActions = availableFlowActions ?? [];
});

// The declared component ids, as a stable signature: a fresh snapshot object
// with the same components must not re-run the load — re-registering would
// produce fresh served classes and recreate every mounted custom element
// (resetting the chat scroll to the top on every push).
const componentsSignature = $derived(Object.keys(components).sort().join(","));

// Load the flow's served components when the flow (or its declared component
// set) changes; unload the previous flow's registrations on teardown. Loading
// is async, so the host is re-synced once the registrations land — the next
// render resolves ui.instanceComponent / custom kinds through the registry.
$effect(() => {
  // Reading flowId and the signature makes the effect re-run (and clean up
  // the previous flow's registrations) only when the flow or its declared
  // component set actually changes — not on every snapshot.
  void flowId;
  void componentsSignature;
  const declared = untrack(() => components);
  let cleanup: (() => void) | undefined;
  let disposed = false;
  void loadFlowComponents(declared).then((restore) => {
    if (disposed) {
      restore();
      return;
    }
    cleanup = restore;
    if (host) {
      host.workflowDefs = workflowDefs;
      host.instances = instances;
      host.requestUpdate();
    }
  });
  return () => {
    disposed = true;
    cleanup?.();
  };
});

function handleAction(
  event: CustomEvent<{
    flowId: string;
    instanceId: string;
    actionId: string;
    payload?: Record<string, unknown>;
  }>
) {
  // Ignore id-less events that bubble up un-stopped from a child component
  // (defense in depth on top of the components' stopPropagation).
  if (!event.detail.flowId || !event.detail.instanceId) return;
  onAction?.(
    event.detail.flowId,
    event.detail.instanceId,
    event.detail.actionId,
    event.detail.payload
  );
}

function handleSendMessage(
  event: CustomEvent<{
    flowId: string;
    instanceId: string;
    content: string;
  }>
) {
  if (!event.detail.flowId || !event.detail.instanceId) return;
  void onSendMessage?.(
    event.detail.flowId,
    event.detail.instanceId,
    event.detail.content
  );
}

function handlePatchState(
  event: CustomEvent<{
    flowId: string;
    instanceId: string;
    values: Record<string, unknown>;
  }>
) {
  if (!event.detail.flowId || !event.detail.instanceId) return;
  onPatchState?.(
    event.detail.flowId,
    event.detail.instanceId,
    event.detail.values
  );
}

function handleSelect(
  event: CustomEvent<{ flowId: string; instanceId: string }>
) {
  if (!event.detail.flowId || !event.detail.instanceId) return;
  onSelect?.(event.detail.flowId, event.detail.instanceId);
}

function handleCreate(
  event: CustomEvent<{ flowId: string; actionId: string }>
) {
  if (!event.detail.flowId || !event.detail.actionId) return;
  onCreate?.(event.detail.flowId, event.detail.actionId);
}

function handleFlowAction(
  event: CustomEvent<{ flowId: string; actionId: string }>
) {
  if (!event.detail.flowId || !event.detail.actionId) return;
  onFlowAction?.(event.detail.flowId, event.detail.actionId);
}
</script>

<workflow-instances
  bind:this={host}
  onhive-action={handleAction}
  onhive-send-message={handleSendMessage}
  onhive-patch-state={handlePatchState}
  onhive-select={handleSelect}
  onhive-create={handleCreate}
  onhive-flow-action={handleFlowAction}
></workflow-instances>
