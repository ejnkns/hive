<script lang="ts">
import { onMount } from "svelte";
import type { Card, PlanningProposal } from "shared/board-types";
import { parsePlanningProposalResponse } from "./parse-planning-proposal-response";

let {
  projectId,
  card,
  initialQuestion,
  onCardUpdated,
  onPlanningProposal,
  onCancel,
}: Props = $props();

type Props = {
  projectId: string;
  card: Card;
  initialQuestion?: string | null;
  onCardUpdated: (card: Card) => void;
  onPlanningProposal?: (proposal: PlanningProposal) => void;
  onCancel: () => void;
};

type Stage = "context" | "question" | "confirmation";

let stage: Stage = $state("context");
let input = $state("");
let question = $state("");
let busy = $state(false);
let error = $state<string | null>(null);
let consumedInitialQuestion = $state("");
let draftRequirements = $state("");

$effect(() => {
  if (initialQuestion && initialQuestion !== consumedInitialQuestion) {
    consumedInitialQuestion = initialQuestion;
    question = initialQuestion;
    stage = "question";
  }
});

async function startRefinement() {
  const prompt = input.trim();
  if (!prompt) return;

  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/cards/${card.id}/devise/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      }
    );
    const result = (await response.json()) as {
      question?: string;
      draftRequirements?: string;
      error?: string;
    };
    if (!response.ok || !result.question) {
      throw new Error(result.error ?? "Could not start card refinement");
    }
    question = result.question;
    draftRequirements = result.draftRequirements ?? draftRequirements;
    input = "";
    stage = "question";
  } catch (err) {
    error =
      err instanceof Error ? err.message : "Could not start card refinement";
  } finally {
    busy = false;
  }
}

async function respond() {
  const answer = input.trim();
  if (!answer) return;

  busy = true;
  error = null;
  try {
    const response = await fetch(
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
      cardProposal?: Partial<Card>;
      draftRequirements?: string;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(result.error ?? "Could not continue card refinement");
    }
    draftRequirements = result.draftRequirements ?? draftRequirements;
    input = "";
    if (result.complete && result.cardProposal) {
      stage = "confirmation";
      return;
    }
    if (!result.question) {
      throw new Error("Card refinement returned no question");
    }
    question = result.question;
  } catch (err) {
    error =
      err instanceof Error ? err.message : "Could not continue card refinement";
  } finally {
    busy = false;
  }
}

async function confirmReady() {
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/cards/${card.id}/devise/approve`,
      {
        method: "POST",
      }
    );
    const result = parsePlanningProposalResponse(await response.json());
    if (!response.ok || !result.proposal) {
      throw new Error(result.error ?? "Could not reconcile card refinement");
    }
    onPlanningProposal?.(result.proposal);
    onCancel();
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not confirm card";
  } finally {
    busy = false;
  }
}

onMount(() => {
  const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/api/queen-bee/ws`
  );
  socket.onmessage = (event) => {
    try {
      const message: unknown = JSON.parse(String(event.data));
      const content = cardDraftContent(message, projectId, card.id);
      if (content !== null) draftRequirements = content;
    } catch {
      // Ignore malformed events.
    }
  };
  return () => socket.close();
});

function cardDraftContent(
  value: unknown,
  project: string,
  selectedCard: string
): string | null {
  if (!isRecord(value) || value.type !== "devise_draft_updated") return null;
  const data = value.data;
  if (
    !isRecord(data) ||
    data.projectId !== project ||
    data.cardId !== selectedCard ||
    typeof data.content !== "string"
  ) {
    return null;
  }
  return data.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
</script>

<div class="refinement">
  {#if stage === "context"}
    <div class="prompt">
      Describe what this card should add or clarify. Queen Bee will update this
      card and the project requirements together.
    </div>
  {:else if stage === "question"}
    <div class="question">
      <div class="role-label">Queen Bee</div>
      {question}
    </div>
  {:else}
    <div class="confirmation">
      <div class="confirmation-title">Card and requirements ready to approve</div>
      <div>
        Confirm to reconcile the proposed card and requirements against the
        whole board. You will review every affected card before applying them.
      </div>
    </div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if draftRequirements}
    <div class="draft-panel">
      <div class="role-label">Live project requirements draft</div>
      <pre>{draftRequirements}</pre>
      <div class="draft-note">
        This remains provisional until whole-board reconciliation is approved.
      </div>
    </div>
  {/if}

  {#if stage !== "confirmation"}
    <textarea
      bind:value={input}
      rows="3"
      placeholder={stage === "context" ? "Add context..." : "Your answer..."}
      disabled={busy}
    ></textarea>
  {/if}

  <div class="actions">
    {#if stage === "context"}
      <button
        class="btn btn-primary"
        onclick={startRefinement}
        disabled={busy || !input.trim()}
      >
        {busy ? "Starting..." : "Start refinement"}
      </button>
    {:else if stage === "question"}
      <button
        class="btn btn-primary"
        onclick={respond}
        disabled={busy || !input.trim()}
      >
        {busy ? "Sending..." : "Send"}
      </button>
    {:else}
      <button class="btn btn-primary" onclick={confirmReady} disabled={busy}>
        {busy ? "Reconciling..." : "Confirm and review changes"}
      </button>
    {/if}
    <button class="btn" onclick={onCancel} disabled={busy}>
      {stage === "confirmation" ? "Keep as Idea" : "Cancel"}
    </button>
  </div>
</div>

<style>
  .refinement {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.75rem;
  }

  .prompt,
  .question,
  .confirmation {
    color: var(--text);
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .draft-panel {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.625rem;
  }

  .draft-panel pre {
    color: var(--text);
    font-family: inherit;
    font-size: 0.6875rem;
    line-height: 1.45;
    margin: 0;
    max-height: 14rem;
    overflow: auto;
    white-space: pre-wrap;
  }

  .draft-note {
    color: var(--muted);
    font-size: 0.625rem;
    margin-top: 0.375rem;
  }

  .question {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.625rem;
  }

  .role-label,
  .confirmation-title {
    color: var(--muted);
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
    text-transform: uppercase;
  }

  .confirmation-title {
    color: var(--accent);
  }

  textarea {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    font-family: inherit;
    font-size: 0.75rem;
    padding: 0.5rem 0.625rem;
    resize: vertical;
  }

  textarea:focus {
    border-color: var(--accent);
    outline: none;
  }

  .actions {
    display: flex;
    gap: 0.375rem;
  }

  .btn {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
    font-size: 0.6875rem;
    padding: 0.375rem 0.625rem;
  }

  .btn:hover:not(:disabled) {
    background: var(--border);
  }

  .btn:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #1b1601;
    font-weight: 600;
  }

  .error {
    background: rgba(220, 60, 60, 0.1);
    border: 1px solid rgba(220, 60, 60, 0.3);
    border-radius: 5px;
    color: #dc3c3c;
    font-size: 0.6875rem;
    padding: 0.375rem 0.5rem;
  }
</style>
