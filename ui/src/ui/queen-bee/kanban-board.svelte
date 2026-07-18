<script lang="ts">
import { onMount } from "svelte";
import type { Card, Column, CoordinatorAction } from "shared/board-types";
import KanbanCard from "./kanban-card.svelte";
import CardDetail from "./card-detail.svelte";

let { projectId, onReDeviseStarted }: Props = $props();

type Props = {
  projectId: string;
  onReDeviseStarted?: () => void;
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
let planning = $state(false);
let running = $state<string | null>(null);
let guidanceShown = $state(false);
let guidanceText = $state("");
let replanError = $state<string | null>(null);

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
  guidanceShown = !guidanceShown;
  guidanceText = "";
  replanError = null;
}

async function handleReDevise() {
  const prompt = window.prompt(
    "What new context should change the project requirements?"
  );
  if (!prompt) return;

  const start = async (confirmActive: boolean) =>
    fetch(`/api/queen-bee/${projectId}/devise/redevise/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, confirmActive }),
    });

  try {
    let response = await start(false);
    if (response.status === 409) {
      const data = (await response.json()) as { error?: string };
      if (
        !window.confirm(
          `${data.error ?? "Active work exists"}. Continue anyway?`
        )
      )
        return;
      response = await start(true);
    }
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error ?? "Could not start re-devise");
    }
    onReDeviseStarted?.();
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not start re-devise";
  }
}

async function handleSubmitReplan() {
  planning = true;
  replanError = null;
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guidance: guidanceText || undefined }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Replanning failed");
    }
    guidanceShown = false;
    guidanceText = "";
    await loadBoard();
  } catch (err) {
    replanError =
      err instanceof Error ? err.message : "Unknown error replanning";
  } finally {
    planning = false;
  }
}

async function handleRunCard(cardId: string) {
  running = cardId;
  try {
    await fetch(`/api/queen-bee/${projectId}/cards/${cardId}/run`, {
      method: "POST",
    });
    await loadBoard();
  } catch {
    // ignore
  } finally {
    running = null;
  }
}

async function handleRemediate(
  cardId: string,
  action: CoordinatorAction,
  suggestionId?: string
) {
  try {
    const res = await fetch(
      `/api/queen-bee/${projectId}/cards/${cardId}/remediate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, suggestionId }),
      }
    );
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Remediation failed");
    }
    selectedCard = null;
    await loadBoard();
  } catch (err) {
    error = err instanceof Error ? err.message : "Remediation failed";
  }
}

async function handleCardDevise(card: Card) {
  const prompt = window.prompt("What should this card add or clarify?");
  if (!prompt) return;

  try {
    let response = await fetch(
      `/api/queen-bee/${projectId}/cards/${card.id}/devise/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      }
    );
    let data = (await response.json()) as { question?: string; error?: string };
    if (!response.ok || !data.question) {
      throw new Error(data.error ?? "Could not start card devise");
    }

    while (data.question) {
      const answer = window.prompt(data.question);
      if (!answer) return;
      response = await fetch(
        `/api/queen-bee/${projectId}/cards/${card.id}/devise/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer }),
        }
      );
      const result = (await response.json()) as {
        question?: string;
        complete?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Could not continue card devise");
      }
      if (result.complete) {
        await moveCard(card.id, "ready");
        selectedCard = null;
        return;
      }
      data = result;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Card devise failed";
  }
}

function cardsInColumn(col: Column): Card[] {
  return board?.cards.filter((c) => c.column === col) ?? [];
}

onMount(() => {
  void loadBoard();

  const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/api/queen-bee/ws`
  );
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        data?: { projectId?: string };
      };
      if (
        message.data?.projectId === projectId ||
        message.type === "reviewer_verdict"
      ) {
        void loadBoard();
      }
    } catch {
      // Ignore malformed events.
    }
  };

  return () => socket.close();
});
</script>

<div class="kanban-board">
  <div class="board-header">
    <h2>Board</h2>
    <div class="board-actions">
      <button class="btn btn-outline" onclick={handleReplan} disabled={planning}>
        {planning ? "Replanning..." : "Replan"}
      </button>
      <button class="btn btn-outline" onclick={handleReDevise} disabled={planning}>
        Re-devise
      </button>
    </div>
  </div>

  {#if guidanceShown}
    <div class="guidance-area">
      <textarea
        class="guidance-input"
        bind:value={guidanceText}
        placeholder="What should the planner change? (optional)"
        rows="2"
        disabled={planning}
      ></textarea>
      <button class="btn btn-primary" onclick={handleSubmitReplan} disabled={planning}>
        {planning ? "Generating..." : "Generate"}
      </button>
    </div>
  {/if}

  {#if replanError}
    <div class="error">{replanError}</div>
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
                onRun={() => handleRunCard(card.id)}
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
      onRun={() => handleRunCard(selectedCard!.id)}
      onRemediate={(action, suggestionId) =>
        handleRemediate(selectedCard!.id, action, suggestionId)}
      onCardDevise={() => handleCardDevise(selectedCard!)}
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

  .guidance-area {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .guidance-input {
    flex: 1;
    padding: 0.5rem 0.625rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    font-size: 0.75rem;
    font-family: inherit;
    resize: vertical;
  }

  .guidance-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .guidance-input:disabled {
    opacity: 0.5;
  }

  .btn-primary {
    background: var(--accent);
    color: #1b1601;
    border-color: var(--accent);
    align-self: flex-start;
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
