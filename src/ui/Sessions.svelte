<script lang="ts">
import type { SessionState } from "./types";
import SessionCard from "./SessionCard.svelte";

let { sessions = [] as SessionState[] } = $props();

const active = $derived(
  sessions.filter((s) =>
    s.requests.some((r) => r.stage !== "complete" && r.stage !== "failed")
  )
);
const completed = $derived(
  sessions.filter(
    (s) =>
      !s.requests.some((r) => r.stage !== "complete" && r.stage !== "failed")
  )
);

let archiveOpen = $state(false);
let expandedIds = $state(new Set<string>());

function toggleArchive() {
  archiveOpen = !archiveOpen;
}

function toggleExpanded(requestId: string) {
  const next = new Set(expandedIds);
  if (next.has(requestId)) {
    next.delete(requestId);
  } else {
    next.add(requestId);
  }
  expandedIds = next;
}
</script>

{#if active.length === 0 && completed.length === 0}
  <div class="no-data">Awaiting requests...</div>
{:else}
  {#if active.length > 0}
    {#each active as session (session.sessionId)}
      <SessionCard {session} />
    {/each}
  {/if}

  {#if completed.length > 0}
    <button class="archive-toggle" onclick={toggleArchive}>
      <span class="archive-arrow">{archiveOpen ? "\u25BE" : "\u25B8"}</span>
      Previous Sessions ({completed.length})
    </button>
    {#if archiveOpen}
      {#each completed as session (session.sessionId)}
        <SessionCard
          {session}
          collapsed={!expandedIds.has(session.sessionId)}
          onToggle={() => toggleExpanded(session.sessionId)}
        />
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
