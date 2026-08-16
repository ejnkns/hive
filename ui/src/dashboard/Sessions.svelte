<script lang="ts">
import type { SessionState } from "shared/dashboard-types";
import Button from "../shared/ui/Button.svelte";
import Skeleton from "../shared/ui/Skeleton.svelte";
import SessionCard from "./SessionCard.svelte";
import { isTerminal } from "./stage-utils.ts";

let { sessions = [] as SessionState[] } = $props();

function hasActiveRequest(s: SessionState): boolean {
  return s.requests.some((r) => {
    const last = r.path[r.path.length - 1];
    return !isTerminal(last);
  });
}

const active = $derived(sessions.filter((s) => hasActiveRequest(s)));
const completed = $derived(sessions.filter((s) => !hasActiveRequest(s)));

const visible = $derived.by(() => {
  if (active.length > 0) return active;
  if (completed.length === 0) return [];
  return [completed[0]];
});

const archived = $derived.by(() => {
  if (active.length > 0) return completed;
  return completed.slice(1);
});

let archiveOpen = $state(false);

function toggleArchive() {
  archiveOpen = !archiveOpen;
}
</script>

{#if visible.length === 0 && archived.length === 0}
  <div class="no-data">
    <Skeleton
      shape="line"
      style="width: 200px; height: 16px; margin: 0 auto 0.5rem;"
    />
    <Skeleton
      shape="line"
      style="width: 280px; height: 14px; margin: 0 auto 0.25rem;"
    />
    <Skeleton
      shape="line"
      style="width: 160px; height: 14px; margin: 0 auto;"
    />
  </div>
{:else}
  {#if visible.length > 0}
    {#each visible as session (session.sessionId)}
      <SessionCard {session} />
    {/each}
  {/if}

  {#if archived.length > 0}
    <Button variant="neutral" onclick={toggleArchive}>
      <span class="archive-arrow">{archiveOpen ? "▾" : "▸"}</span>
      previous sessions ({archived.length})
    </Button>
    {#if archiveOpen}
      {#each archived as session (session.sessionId)}
        <SessionCard {session} />
      {/each}
    {/if}
  {/if}
{/if}

<style>
.no-data {
  padding: 1.5rem;
  text-align: center;
  color: var(--muted);
  font-size: var(--text-base);
}
.archive-arrow {
  font-size: var(--text-xs);
}
</style>
