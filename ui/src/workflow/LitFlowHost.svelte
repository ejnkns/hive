<script lang="ts">
import { untrack } from "svelte";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type {
  CustomRenderKind,
  FlowViewFlow,
} from "workflow-engine/workflow-types";
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
  flow,
  flowComponent,
  workflowDefs,
  instances,
  customKinds,
  components,
  availableFlowActions,
  persistedOutputs,
  persistedOutputDirs,
  onAction,
  onSendMessage,
  onPatchState,
  onSelect,
  onCreate,
  onFlowAction,
}: {
  flowId: string;
  flow?: FlowViewFlow;
  flowComponent?: string;
  workflowDefs: WorkflowDefResponse[];
  instances: WorkflowInstanceEntry[];
  customKinds: readonly CustomRenderKind[];
  // Served component ids → fetch path, from the flow snapshot's ui.components.
  components: Record<string, string>;
  availableFlowActions?: FlowLevelAction[];
  persistedOutputs?: Record<string, string>;
  persistedOutputDirs?: Record<string, Record<string, string>>;
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

// The latest snapshot awaiting a host sync. During a running agent the server
// bursts many WS flow_snapshot frames back-to-back; feeding each one straight
// through re-renders the whole flow-component page per frame of agent progress
// and churns the main thread so the page can't be scrolled. The effect stores
// the newest snapshot and flushes it once per animation frame instead.
type SyncSnapshot = {
  flowId: string;
  flow?: FlowViewFlow;
  flowComponent?: string;
  workflowDefs: WorkflowDefResponse[];
  instances: WorkflowInstanceEntry[];
  customKinds: readonly CustomRenderKind[];
  availableFlowActions: FlowLevelAction[];
  persistedOutputs: Record<string, string>;
  persistedOutputDirs: Record<string, Record<string, string>>;
};

let pending: SyncSnapshot | null = null;
let syncFrame: number | undefined;

function flushSnapshot(snapshot: SyncSnapshot): void {
  if (host === null) return;
  host.flowId = snapshot.flowId;
  host.flow = snapshot.flow;
  host.flowComponent = snapshot.flowComponent;
  host.workflowDefs = snapshot.workflowDefs;
  host.instances = snapshot.instances;
  host.customKinds = snapshot.customKinds;
  host.availableFlowActions = snapshot.availableFlowActions;
  host.persistedOutputs = snapshot.persistedOutputs;
  host.persistedOutputDirs = snapshot.persistedOutputDirs;
}

$effect(() => {
  if (!host) return;
  pending = {
    flowId,
    flow,
    flowComponent,
    workflowDefs,
    instances,
    customKinds,
    availableFlowActions: availableFlowActions ?? [],
    persistedOutputs: persistedOutputs ?? {},
    persistedOutputDirs: persistedOutputDirs ?? {},
  };
  if (pending !== null && syncFrame === undefined) {
    syncFrame = requestAnimationFrame(() => {
      syncFrame = undefined;
      const latest = pending;
      pending = null;
      if (latest !== null) flushSnapshot(latest);
    });
  }
  return () => {
    if (syncFrame !== undefined) {
      cancelAnimationFrame(syncFrame);
      syncFrame = undefined;
    }
  };
});

// The declared component paths, as a stable signature: a fresh snapshot object
// with the same paths must not re-run the load — re-registering would produce
// fresh served classes and recreate every mounted custom element (resetting
// the chat scroll to the top on every push). The paths embed the `?v=` module
// version, so a definition save (a new version hash) changes the signature and
// deliberately re-loads the new version, while snapshot churn (same versions)
// never does.
const componentsSignature = $derived(
  Object.values(components).sort().join(",")
);

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
