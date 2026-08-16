<script lang="ts">
import { slugify } from "shared/slugify";
import type { FlowResponse } from "../flow-api.ts";
import Button from "../shared/ui/Button.svelte";
import StatusDot from "./StatusDot.svelte";

let {
  definitionId,
  flows,
}: {
  definitionId: string;
  flows: FlowResponse[];
} = $props();

function instanceHref(flow: FlowResponse): string {
  return `#/flows/${encodeURIComponent(definitionId)}/${encodeURIComponent(
    slugify(String(flow.config?.name ?? flow.id))
  )}`;
}
</script>

{#if flows.length > 0}
  <div class="roster">
    {#each flows as flow (flow.id)}
      <a class="instance-tile" href={instanceHref(flow)}>
        <StatusDot status={flow.status} />
        <span class="tile-name">{flow.config?.name ?? flow.id}</span>
      </a>
    {/each}
    <Button
      variant="accent"
      size="icon"
      class="tile-add"
      aria-label="new instance"
      onclick={() =>
        (window.location.hash = `#/flows/${encodeURIComponent(definitionId)}/new`)}
    >
      +
    </Button>
  </div>
{/if}

<style>
/* instances as content-sized tiles, wrapping; the + stays a small square */
.roster {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-3);
}

.instance-tile {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 6px var(--space-2);
  background: rgba(var(--border-rgb), 0.25);
  color: var(--text);
  font-size: var(--text-sm);
  text-decoration: none;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.instance-tile:hover {
  background: var(--accent);
  color: var(--on-accent);
}

.tile-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
