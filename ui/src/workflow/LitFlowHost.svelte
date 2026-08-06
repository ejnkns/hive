<script lang="ts">
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { CustomRenderKind } from "workflow-engine/workflow-types";
import type { WorkflowInstances } from "../flow-rendering";
import { loadFlowComponents } from "../flow-rendering/load-flow-components";

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
  onAction,
  onSendMessage,
}: {
  flowId: string;
  workflowDefs: WorkflowDefResponse[];
  instances: WorkflowInstanceEntry[];
  customKinds: readonly CustomRenderKind[];
  // Served component ids → fetch path, from the flow snapshot's ui.components.
  components: Record<string, string>;
  onAction?: (flowId: string, instanceId: string, actionId: string) => void;
  onSendMessage?: (
    flowId: string,
    instanceId: string,
    content: string
  ) => Promise<void>;
} = $props();

let host: WorkflowInstances | null = null;

$effect(() => {
  if (!host) return;
  host.flowId = flowId;
  host.workflowDefs = workflowDefs;
  host.instances = instances;
  host.customKinds = customKinds;
});

// Load the flow's served components when the flow (or its declared component
// set) changes; unload the previous flow's registrations on teardown. Loading
// is async, so the host is re-synced once the registrations land — the next
// render resolves ui.instanceComponent / custom kinds through the registry.
$effect(() => {
  // Reading flowId makes the effect re-run (and clean up the previous flow's
  // registrations) when the flow changes even if the component set is shared.
  void flowId;
  const declared = components;
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
  }>
) {
  // Ignore id-less events that bubble up un-stopped from a child component
  // (defense in depth on top of the components' stopPropagation).
  if (!event.detail.flowId || !event.detail.instanceId) return;
  onAction?.(
    event.detail.flowId,
    event.detail.instanceId,
    event.detail.actionId
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
</script>

<workflow-instances
  bind:this={host}
  onhive-action={handleAction}
  onhive-send-message={handleSendMessage}
></workflow-instances>
