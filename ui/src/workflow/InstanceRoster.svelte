<script lang="ts">
import type { FlowResponse } from "./flow-api";
import { deleteFlow, slugify } from "./flow-api";
import StatusDot from "./StatusDot.svelte";

let {
  definitionId,
  flows,
  onDeleted,
  onError,
}: {
  definitionId: string;
  flows: FlowResponse[];
  onDeleted: () => void;
  onError: (err: string) => void;
} = $props();

function instanceHref(flow: FlowResponse): string {
  return `#/flows/${encodeURIComponent(definitionId)}/${encodeURIComponent(
    slugify(String(flow.config?.name ?? flow.id))
  )}`;
}

async function remove(flow: FlowResponse) {
  try {
    await deleteFlow(flow.id);
    onDeleted();
  } catch (err) {
    onError(err instanceof Error ? err.message : "Failed to delete instance");
  }
}
</script>

{#if flows.length === 0}
  <div class="roster-empty">No instances yet.</div>
{:else}
  <div class="roster">
    {#each flows as flow (flow.id)}
      <div class="roster-row">
        <a class="roster-link" href={instanceHref(flow)}>
          <StatusDot status={flow.status} />
          <span class="roster-name">{flow.config?.name ?? flow.id}</span>
        </a>
        <button
          type="button"
          class="roster-delete"
          aria-label={`Delete ${flow.config?.name ?? flow.id}`}
          onclick={() => remove(flow)}
        >
          Delete
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
.roster {
  display: flex;
  flex-direction: column;
}

.roster-empty {
  font-size: 0.75rem;
  color: var(--muted);
  padding: 0.5rem 0;
}

.roster-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.375rem 0;
  border-top: 1px solid var(--border);
}

.roster-row:first-child {
  border-top: none;
}

.roster-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  text-decoration: none;
  color: var(--text);
  font-size: 0.8125rem;
}

.roster-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.roster-link:hover .roster-name {
  color: var(--accent);
}

.roster-delete {
  border: none;
  background: transparent;
  color: var(--muted);
  font-family: monospace;
  font-size: 0.625rem;
  cursor: pointer;
  padding: 2px 4px;
}

.roster-delete:hover {
  color: var(--error);
}
</style>
