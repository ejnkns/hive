<script lang="ts">
import { slugify } from "shared/slugify";
import type { FlowResponse } from "../flow-api.ts";
import { deleteFlow } from "../flow-api.ts";
import Button from "../shared/ui/Button.svelte";
import Dialog from "../shared/ui/Dialog.svelte";
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

let deleteOpen = $state(false);
let deleteTarget = $state<FlowResponse | null>(null);
let deleting = $state(false);

function instanceHref(flow: FlowResponse): string {
  return `#/flows/${encodeURIComponent(definitionId)}/${encodeURIComponent(
    slugify(String(flow.config?.name ?? flow.id))
  )}`;
}

function askDelete(flow: FlowResponse) {
  deleteTarget = flow;
  deleteOpen = true;
}

async function confirmDelete() {
  if (!deleteTarget) return;
  deleting = true;
  try {
    await deleteFlow(deleteTarget.id);
    deleteOpen = false;
    deleteTarget = null;
    onDeleted();
  } catch (err) {
    onError(err instanceof Error ? err.message : "Failed to delete instance");
  } finally {
    deleting = false;
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
          onclick={() => askDelete(flow)}
        >
          Delete
        </button>
      </div>
    {/each}
  </div>
{/if}

<Dialog bind:open={deleteOpen} label="Delete instance" contentMaxWidth="420px">
  {#if deleteTarget}
    <h2 class="dialog-title">Delete instance</h2>
    <p class="dialog-text">
      Delete "{deleteTarget.config?.name ?? deleteTarget.id}"? This removes the
      flow instance's operational state and cannot be undone.
    </p>
    <div class="dialog-actions">
      <Button variant="rose" disabled={deleting} onclick={confirmDelete}>
        {deleting ? "Deleting..." : "Delete instance"}
      </Button>
      <Button variant="platinum" onclick={() => (deleteOpen = false)}>
        Cancel
      </Button>
    </div>
  {/if}
</Dialog>

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
</style>
