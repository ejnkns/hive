<script lang="ts">
import { onMount } from "svelte";
import DeviseChat from "./devise-chat.svelte";
import KanbanBoard from "./kanban-board.svelte";

let { projectId }: Props = $props();

type Props = {
  projectId: string;
};

let hasRequirements = $state<boolean | null>(null);
let hasBoard = $state<boolean | null>(null);
let loading = $state(true);

onMount(() => {
  checkStatus();
});

async function checkStatus() {
  loading = true;
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/devise/status`);
    if (!res.ok) throw new Error("Failed to load project");
    const data = (await res.json()) as { hasRequirements: boolean };
    hasRequirements = data.hasRequirements;

    if (data.hasRequirements) {
      try {
        const boardRes = await fetch(`/api/queen-bee/${projectId}/board`);
        if (boardRes.ok) {
          const boardData = (await boardRes.json()) as { cards: unknown[] };
          hasBoard =
            Array.isArray(boardData.cards) && boardData.cards.length > 0;
        }
      } catch {
        hasBoard = false;
      }
    }
  } catch {
    hasRequirements = null;
  } finally {
    loading = false;
  }
}
</script>

<div class="project-page">
  <div class="header">
    <a href="#/" class="back-link">&larr; Projects</a>
    <span class="project-id">{projectId}</span>
  </div>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if hasBoard}
    <KanbanBoard {projectId} />
  {:else if hasRequirements === true}
    <div class="placeholder">
      <div class="placeholder-icon">+</div>
      <h2>Requirements Complete</h2>
      <p>Open the board and click "Plan Cards" to generate tasks.</p>
    </div>
  {:else if hasRequirements === false}
    <DeviseChat {projectId} />
  {:else}
    <div class="loading">Could not load project.</div>
  {/if}
</div>

<style>
  .project-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }

  .back-link {
    font-size: 0.8125rem;
    color: var(--muted);
    text-decoration: none;
  }

  .back-link:hover {
    color: var(--text);
  }

  .project-id {
    font-size: 0.75rem;
    color: var(--muted);
    font-family: var(--font-mono, monospace);
  }

  .loading {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .placeholder {
    text-align: center;
    padding: 3rem 1rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .placeholder-icon {
    font-size: 2rem;
    color: var(--accent);
    margin-bottom: 0.5rem;
  }

  .placeholder h2 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 0.5rem 0;
  }

  .placeholder p {
    font-size: 0.8125rem;
    color: var(--muted);
    margin: 0;
  }
</style>
