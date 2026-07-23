<script lang="ts">
import type { SessionState } from "shared/dashboard-types";
import SessionCard from "./SessionCard.svelte";

let { sessions = [] as SessionState[] } = $props();

function hasActiveRequest(s: SessionState): boolean {
  return s.requests.some((r) => {
    const last = r.path[r.path.length - 1];
    return last !== "complete" && last !== "failed";
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
  <div class="no-data">Awaiting requests...</div>
{:else}
  {#if visible.length > 0}
    {#each visible as session (session.sessionId)}
      <SessionCard {session} />
    {/each}
  {/if}

  {#if archived.length > 0}
    <button type="button" class="archive-toggle" onclick={toggleArchive}>
      <span class="archive-arrow">{archiveOpen ? "\u25BE" : "\u25B8"}</span>
      Previous Sessions ({archived.length})
    </button>
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
  font-size: 0.8125rem;
}
.archive-toggle {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: none;
  border: 1px solid var(--border);
  color: var(--muted);
  font-family: monospace;
  font-size: 0.625rem;
  cursor: pointer;
  width: 100%;
  text-align: left;
  margin-bottom: 0.25rem;
}
.archive-toggle:hover {
  background: rgba(var(--border-rgb), 0.08);
}
.archive-arrow {
  font-size: 0.625rem;
}
</style>
