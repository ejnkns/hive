<script lang="ts">
import type { Card, Column } from "shared/board-types";
import KanbanCard from "./kanban-card.svelte";
import CardDetail from "./card-detail.svelte";

let { projectId, onAmend }: Props = $props();

type Props = {
  projectId: string;
  onAmend: () => void;
};

type Board = {
  projectId: string;
  cards: Card[];
};

const COLUMNS: Column[] = [
  "idea",
  "ready",
  "in_progress",
  "reviewing",
  "done",
  "unfulfillable",
];

const COLUMN_LABELS: Record<Column, string> = {
  idea: "Idea",
  ready: "Ready",
  in_progress: "In Progress",
  reviewing: "Reviewing",
  done: "Done",
  unfulfillable: "Unfulfillable",
};

let board: Board | null = $state(null);
let loading = $state(true);
let error = $state<string | null>(null);
let selectedCard: Card | null = $state(null);
let showRequirements = $state(false);
let requirementsText = $state("");
let reqLoading = $state(false);
let planning = $state(false);

async function loadBoard() {
  loading = true;
  error = null;
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/board`);
    if (!res.ok) throw new Error("Failed to load board");
    board = (await res.json()) as Board;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  } finally {
    loading = false;
  }
}

async function loadRequirements() {
  if (requirementsText) {
    showRequirements = !showRequirements;
    return;
  }
  showRequirements = true;
  reqLoading = true;
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/requirements`);
    if (res.ok) {
      const data = (await res.json()) as { content: string };
      requirementsText = data.content;
    }
  } catch {
    // ignore
  } finally {
    reqLoading = false;
  }
}

function toggleRequirements() {
  if (showRequirements) {
    showRequirements = false;
  } else {
    loadRequirements();
  }
}

async function moveCard(cardId: string, column: Column) {
  try {
    await fetch(`/api/queen-bee/${projectId}/cards/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column }),
    });
    await loadBoard();
  } catch {
    // ignore
  }
}

async function handleReplan() {
  planning = true;
  try {
    await fetch(`/api/queen-bee/${projectId}/plan`, {
      method: "POST",
    });
    await loadBoard();
  } catch {
    // ignore
  } finally {
    planning = false;
  }
}

function cardsInColumn(col: Column): Card[] {
  return board?.cards.filter((c) => c.column === col) ?? [];
}

loadBoard();
</script>

<div class="kanban-board">
  <div class="board-header">
    <h2>Board</h2>
    <div class="board-actions">
      <button class="btn btn-outline" onclick={toggleRequirements}>
        {showRequirements ? "Hide" : "View"} Requirements
      </button>
      <button class="btn btn-outline" onclick={onAmend}>
        Amend
      </button>
      <button class="btn btn-outline" onclick={handleReplan} disabled={planning}>
        {planning ? "Replanning..." : "Replan"}
      </button>
    </div>
  </div>

  {#if showRequirements}
    <div class="requirements-bar">
      {#if reqLoading}
        <div class="req-loading">Loading...</div>
      {:else}
        <pre class="req-content">{requirementsText}</pre>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading board...</div>
  {:else if board}
    <div class="columns">
      {#each COLUMNS as col}
        <div class="column" class:empty={cardsInColumn(col).length === 0}>
          <div class="column-header">
            <span class="column-name">{COLUMN_LABELS[col]}</span>
            <span class="column-count">{cardsInColumn(col).length}</span>
          </div>
          <div class="column-cards">
            {#each cardsInColumn(col) as card (card.id)}
              <KanbanCard
                {card}
                currentColumn={col}
                onSelect={() => (selectedCard = card)}
                onMove={(target) => moveCard(card.id, target)}
              />
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty">
      <p>No board yet.</p>
    </div>
  {/if}

  {#if selectedCard}
    <CardDetail
      card={selectedCard}
      onClose={() => (selectedCard = null)}
      onMove={(col) => {
        if (selectedCard) {
          moveCard(selectedCard.id, col);
          selectedCard = null;
        }
      }}
    />
  {/if}
</div>

<style>
  .kanban-board {
    max-width: 100%;
  }

  .board-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .board-header h2 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .board-actions {
    display: flex;
    gap: 0.375rem;
  }

  .requirements-bar {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 0.75rem;
    max-height: 200px;
    overflow-y: auto;
  }

  .req-loading {
    padding: 0.75rem;
    font-size: 0.75rem;
    color: var(--muted);
  }

  .req-content {
    padding: 0.75rem;
    margin: 0;
    font-size: 0.6875rem;
    font-family: var(--font-mono, monospace);
    color: var(--text);
    white-space: pre-wrap;
    line-height: 1.5;
  }

  .btn {
    padding: 0.375rem 0.625rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    font-size: 0.6875rem;
    font-weight: 500;
    cursor: pointer;
    background: var(--surface);
    color: var(--text);
    white-space: nowrap;
  }

  .btn:hover:not(:disabled) {
    background: var(--border);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn-outline {
    background: transparent;
  }

  .error {
    background: rgba(220, 60, 60, 0.1);
    border: 1px solid rgba(220, 60, 60, 0.3);
    color: #dc3c3c;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .loading {
    font-size: 0.8125rem;
    color: var(--muted);
    padding: 2rem 0;
    text-align: center;
  }

  .empty {
    text-align: center;
    padding: 2rem 1rem;
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0.75rem;
  }

  .column {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.75rem;
    min-height: 200px;
  }

  .column.empty {
    opacity: 0.6;
  }

  .column-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .column-name {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .column-count {
    font-size: 0.6875rem;
    color: var(--muted);
    background: var(--bg);
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
  }

  .column-cards {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
</style>
