<script lang="ts">
import WorkflowStateCard from "./WorkflowStateCard.svelte";
import type {
  FlowResponse,
  WorkflowDef,
  WorkflowInstanceEntry,
} from "./workflow-api";

let {
  flowDef,
  flowDefs,
  instances,
  onAction,
  onSendMessage,
}: {
  flowDef: { id: string; label: string };
  flowDefs: WorkflowDef[];
  instances: WorkflowInstanceEntry[];
  onAction?: (flowId: string, instanceId: string, actionId: string) => void;
  onSendMessage?: (
    flowId: string,
    instanceId: string,
    content: string
  ) => Promise<void>;
} = $props();

let workflowDefMap = $derived(new Map(flowDefs.map((w) => [w.id, w])));

let instancesByWorkflow = $derived.by(() => {
  const map = new Map<string, WorkflowInstanceEntry[]>();
  for (const inst of instances) {
    const existing = map.get(inst.workflowId) ?? [];
    existing.push(inst);
    map.set(inst.workflowId, existing);
  }
  return map;
});
</script>

<div class="flow">
  <div class="flow-header">
    <span class="flow-label">{flowDef.label}</span>
    <span class="flow-count"
      >{instances.length}
      instance{instances.length !== 1 ? "s" : ""}</span
    >
  </div>

  <div class="flow-instances">
    {#each instances as instance (instance.id)}
      {@const wfDef = workflowDefMap.get(instance.workflowId)}
      {#if wfDef}
        <WorkflowStateCard
          workflowDef={wfDef}
          instanceEntry={instance}
          onAction={(actionId) => onAction?.(flowDef.id, instance.id, actionId)}
          onSendMessage={async (content) => {
            await onSendMessage?.(flowDef.id, instance.id, content);
          }}
        />
      {/if}
    {/each}
  </div>
</div>

<style>
.flow {
  margin-bottom: 0.5rem;
}

.flow-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.flow-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.flow-count {
  font-size: 0.5625rem;
  color: var(--muted);
  font-family: monospace;
}

.flow-instances {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
