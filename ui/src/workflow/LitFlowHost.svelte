<script lang="ts">
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { CustomRenderKind } from "workflow-engine/workflow-types";
import type { WorkflowInstances } from "../flow-rendering";

// The Svelte adapter for the Lit rendering surface: forwards the flow's
// workflow definitions and instances to the workflow-instances element and
// forwards its action/message events back as callbacks. The app shell stays
// Svelte; everything below this element is Lit + Web Components.

let {
  flowId,
  workflowDefs,
  instances,
  customKinds,
  onAction,
  onSendMessage,
}: {
  flowId: string;
  workflowDefs: WorkflowDefResponse[];
  instances: WorkflowInstanceEntry[];
  customKinds: readonly CustomRenderKind[];
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
