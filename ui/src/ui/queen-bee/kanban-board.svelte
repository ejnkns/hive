<script lang="ts">
import { onMount } from "svelte";
import { projectSocket } from "./project-socket.svelte";
import type {
  Board,
  Card,
  Column,
  CoordinatorAction,
  Idea,
  PlanningProposal,
  ReviewReadiness,
  RequirementsFeedback,
  WorkerAdmission,
} from "shared/board-types";
import { COLUMN_LABELS } from "shared/board-types";
import KanbanCard from "./kanban-card.svelte";
import CardDetail from "./card-detail.svelte";
import IdeasBacklog from "./ideas-backlog.svelte";
import { parseReviewReadinessResponse } from "./kanban-board/parse-review-readiness-response";
import { parseWorkerRunResponse } from "./kanban-board/parse-worker-run-response";
import ProjectWorkerSettings from "./project-worker-settings.svelte";

let {
  projectId,
  onReDeviseStarted,
  onPlanningProposal,
  onRequirementsFeedback,
}: Props = $props();

type Props = {
  projectId: string;
  onReDeviseStarted?: () => void;
  onPlanningProposal?: (proposal: PlanningProposal) => void;
  onRequirementsFeedback?: (feedback: RequirementsFeedback) => void;
};

const COLUMNS: Column[] = [
  "ready",
  "in_progress",
  "reviewing",
  "done",
  "unfulfillable",
];

let board: Board | null = $state(null);
let loading = $state(true);
let error = $state<string | null>(null);
let selectedCard: Card | null = $state(null);
let revising = $state(false);
let running = $state<string | null>(null);
let revisionShown = $state(false);
let revisionText = $state("");
let revisionError = $state<string | null>(null);
let activeWorkWarning = $state<string | null>(null);
let refinementQuestion = $state<string | null>(null);
let pendingAdmission = $state<{
  cardId: string;
  admission: WorkerAdmission;
} | null>(null);
let reviewReadiness = $state<Record<string, ReviewReadiness>>({});
let readinessRequest = 0;
let boardRequest = 0;

async function loadBoard() {
  const request = ++boardRequest;
  if (board === null) loading = true;
  error = null;
  try {
    const res = await fetch(`/api/queen-bee/${projectId}/board`);
    if (!res.ok) throw new Error("Failed to load board");
    const loadedBoard = (await res.json()) as Board;
    if (request !== boardRequest) return;
    applyBoard(loadedBoard);
  } catch (err) {
    if (request !== boardRequest) return;
    error = err instanceof Error ? err.message : "Unknown error";
  } finally {
    if (request === boardRequest) loading = false;
  }
}

function applyBoard(nextBoard: Board) {
  board = nextBoard;
  loading = false;
  void loadReviewReadiness(nextBoard.cards);
  if (selectedCard) {
    selectedCard =
      nextBoard.cards.find((card) => card.id === selectedCard?.id) ?? null;
  }
}

async function loadReviewReadiness(cards: Card[]) {
  const request = ++readinessRequest;
  const entries = await Promise.all(
    cards
      .filter((card) => card.column === "reviewing")
      .map(async (card): Promise<[string, ReviewReadiness] | null> => {
        try {
          const response = await fetch(
            `/api/queen-bee/${projectId}/cards/${card.id}/review-readiness`
          );
          const result = parseReviewReadinessResponse(await response.json());
          return response.ok && result.readiness
            ? [card.id, result.readiness]
            : null;
        } catch {
          return null;
        }
      })
  );
  if (request !== readinessRequest) return;
  reviewReadiness = Object.fromEntries(
    entries.filter(
      (entry): entry is [string, ReviewReadiness] => entry !== null
    )
  );
}

function toggleRevision() {
  revisionShown = !revisionShown;
  revisionText = "";
  revisionError = null;
  activeWorkWarning = null;
}

async function submitRevision(confirmActive = false) {
  const prompt = revisionText.trim();
  if (!prompt) return;
  revising = true;
  revisionError = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/requirements/revision/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, confirmActive }),
      }
    );
    if (response.status === 409) {
      const data = (await response.json()) as { error?: string };
      activeWorkWarning = data.error ?? "Active work exists";
      return;
    }
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error ?? "Could not start revision");
    }
    revisionShown = false;
    revisionText = "";
    activeWorkWarning = null;
    onReDeviseStarted?.();
  } catch (err) {
    revisionError =
      err instanceof Error ? err.message : "Could not start revision";
  } finally {
    revising = false;
  }
}

async function handleRunCard(cardId: string, confirmRisks = false) {
  running = cardId;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/cards/${cardId}/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmRisks }),
      }
    );
    const result = parseWorkerRunResponse(await response.json());
    if (!response.ok) {
      if (result.admission?.canOverride) {
        pendingAdmission = { cardId, admission: result.admission };
        return;
      }
      throw new Error(result.error ?? "Could not start Worker Agent");
    }
    pendingAdmission = null;
    await loadBoard();
  } catch (runError) {
    error =
      runError instanceof Error
        ? runError.message
        : "Could not start Worker Agent";
  } finally {
    running = null;
  }
}

async function handleAcceptCard(cardId: string) {
  const response = await fetch(
    `/api/queen-bee/${projectId}/cards/${cardId}/accept`,
    { method: "POST" }
  );
  const result = (await response.json()) as { card?: Card; error?: string };
  if (!response.ok || !result.card) {
    throw new Error(result.error ?? "Could not accept reviewed work");
  }
  handleCardUpdated(result.card);
}

async function handleRequestChanges(cardId: string, guidance: string) {
  const response = await fetch(
    `/api/queen-bee/${projectId}/cards/${cardId}/request-changes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guidance }),
    }
  );
  const result = (await response.json()) as { card?: Card; error?: string };
  if (!response.ok || !result.card) {
    throw new Error(result.error ?? "Could not request changes");
  }
  handleCardUpdated(result.card);
}

async function handleRestartReview(cardId: string) {
  const response = await fetch(
    `/api/queen-bee/${projectId}/cards/${cardId}/restart-review`,
    { method: "POST" }
  );
  const result = (await response.json()) as { card?: Card; error?: string };
  if (!response.ok || !result.card) {
    throw new Error(result.error ?? "Could not restart review");
  }
  handleCardUpdated(result.card);
}

async function handleRemediate(
  cardId: string,
  action: CoordinatorAction,
  suggestionId?: string
) {
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
  const result = (await res.json()) as {
    card?: Card;
    proposal?: PlanningProposal;
    feedback?: RequirementsFeedback;
    redevise?: boolean;
    question?: string;
  };
  if (result.feedback) {
    selectedCard = null;
    onRequirementsFeedback?.(result.feedback);
    return;
  }
  if (result.proposal) {
    selectedCard = null;
    onPlanningProposal?.(result.proposal);
    return;
  }
  if (!result.card) throw new Error("Remediation returned no result");
  handleCardUpdated(result.card);
  if (result.redevise && result.question) {
    refinementQuestion = result.question;
    return;
  }
  refinementQuestion = null;
  selectedCard = null;
  await loadBoard();
}

function handleCardUpdated(updatedCard: Card) {
  if (board) {
    board = {
      ...board,
      cards: board.cards.map((card) =>
        card.id === updatedCard.id ? updatedCard : card
      ),
    };
  }
  selectedCard = updatedCard;
  void loadReviewReadiness(board?.cards ?? [updatedCard]);
}

function confirmPendingAdmission() {
  const pending = pendingAdmission;
  if (pending) void handleRunCard(pending.cardId, true);
}

function selectCard(card: Card) {
  refinementQuestion = null;
  selectedCard = card;
}

function runSelectedCard() {
  const card = selectedCard;
  if (card) void handleRunCard(card.id);
}

function acceptSelectedCard() {
  const card = selectedCard;
  return card ? handleAcceptCard(card.id) : Promise.resolve();
}

function requestChangesForSelectedCard(guidance: string) {
  const card = selectedCard;
  return card ? handleRequestChanges(card.id, guidance) : Promise.resolve();
}

function restartReviewForSelectedCard() {
  const card = selectedCard;
  return card ? handleRestartReview(card.id) : Promise.resolve();
}

function remediateSelectedCard(
  action: CoordinatorAction,
  suggestionId?: string
) {
  const card = selectedCard;
  return card
    ? handleRemediate(card.id, action, suggestionId)
    : Promise.resolve();
}

function cardsInColumn(col: Column): Card[] {
  return board?.cards.filter((c) => c.column === col) ?? [];
}

onMount(() => {
  void loadBoard();
});

$effect(() => {
  // Reactive dependency: re-runs on every board_updated event
  projectSocket.boardVersion;
  void loadBoard();
});
</script>

<div class="kanban-board">
  <div class="board-header">
    <h2>Board</h2>
    <div class="board-actions">
      <ProjectWorkerSettings {projectId} />
      <button class="btn btn-outline" onclick={toggleRevision} disabled={revising}>
        {revising ? "Starting revision..." : "Revise"}
      </button>
    </div>
  </div>

  {#if revisionShown}
    <div class="revision-area">
      <textarea
        class="revision-input"
        bind:value={revisionText}
        placeholder="What context should change the project requirements and regenerated cards?"
        rows="2"
        disabled={revising}
      ></textarea>
      <div class="revision-actions">
        <button
          class="btn btn-primary"
          onclick={() => submitRevision(false)}
          disabled={revising || !revisionText.trim()}
        >
          {revising ? "Starting..." : "Revise requirements"}
        </button>
        <button class="btn" onclick={toggleRevision} disabled={revising}>Cancel</button>
      </div>
      {#if activeWorkWarning}
        <div class="revision-warning">
          <span>{activeWorkWarning}. Continuing may invalidate active work.</span>
          <button
            class="btn btn-danger"
            onclick={() => submitRevision(true)}
            disabled={revising}
          >
            Continue and regenerate
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if revisionError}
    <div class="error">{revisionError}</div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if pendingAdmission}
    <div class="worker-risk">
      <div>
        <strong>Confirm parallel work risks</strong>
        <ul>
          {#each pendingAdmission.admission.blockers as blocker}
            <li>
              {blocker.message}{blocker.files?.length
                ? `: ${blocker.files.join(", ")}`
                : ""}
            </li>
          {/each}
        </ul>
      </div>
      <div class="worker-risk-actions">
        <button
          class="btn btn-danger"
          onclick={confirmPendingAdmission}
          disabled={running === pendingAdmission.cardId}
        >
          {running === pendingAdmission.cardId ? "Starting..." : "Run anyway"}
        </button>
        <button class="btn" onclick={() => (pendingAdmission = null)}>
          Cancel
        </button>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading board...</div>
  {:else if board}
    <IdeasBacklog
      {projectId}
      ideas={board.ideas}
      onChanged={loadBoard}
      {onPlanningProposal}
      {onRequirementsFeedback}
    />
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
                reviewReadiness={reviewReadiness[card.id]}
                onSelect={() => selectCard(card)}
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
      reviewReadiness={reviewReadiness[selectedCard.id]}
      {projectId}
      initialRefinementQuestion={refinementQuestion}
      onClose={() => {
        refinementQuestion = null;
        selectedCard = null;
      }}
      onCardUpdated={handleCardUpdated}
      {onPlanningProposal}
      {onRequirementsFeedback}
      onRun={runSelectedCard}
      onAccept={acceptSelectedCard}
      onRequestChanges={requestChangesForSelectedCard}
      onRestartReview={restartReviewForSelectedCard}
      onRemediate={remediateSelectedCard}
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

  .worker-risk {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
    padding: 0.75rem;
    border: 1px solid #8a6d1d;
    border-radius: 6px;
    background: rgba(138, 109, 29, 0.12);
    color: var(--text);
    font-size: 0.75rem;
  }

  .worker-risk ul {
    margin: 0.375rem 0 0;
    padding-left: 1.25rem;
    color: var(--muted);
  }

  .worker-risk-actions {
    display: flex;
    flex-shrink: 0;
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

  .revision-area {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .revision-input {
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

  .revision-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .revision-input:disabled {
    opacity: 0.5;
  }

  .revision-actions {
    display: flex;
    gap: 0.375rem;
  }

  .revision-warning {
    align-items: center;
    background: rgba(220, 120, 40, 0.1);
    border: 1px solid rgba(220, 120, 40, 0.35);
    border-radius: 6px;
    color: var(--text);
    display: flex;
    font-size: 0.75rem;
    gap: 0.75rem;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
  }

  .btn-danger {
    border-color: #dc783c;
    color: #dc783c;
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
