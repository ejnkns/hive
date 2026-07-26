<script lang="ts">
import type {
  Card,
  PlanningProposal,
  RequirementsFeedback,
} from "shared/board-types";
import Button from "../shared/ui/Button.svelte";
import Textarea from "../shared/ui/Textarea.svelte";
import { parsePlanningProposalResponse } from "./parse-planning-proposal-response";
import { projectSocket } from "./project-socket.svelte";

let {
  projectId,
  card,
  initialQuestion,
  onCardUpdated,
  onPlanningProposal,
  onRequirementsFeedback,
  onCancel,
}: Props = $props();

type Props = {
  projectId: string;
  card: Card;
  initialQuestion?: string | null;
  onCardUpdated: (card: Card) => void;
  onPlanningProposal?: (proposal: PlanningProposal) => void;
  onRequirementsFeedback?: (feedback: RequirementsFeedback) => void;
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
let settled = $state(true);

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

  settled = false;
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/cards/${card.id}/requirements/start`,
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
    settled = true;
  }
}

async function respond() {
  const answer = input.trim();
  if (!answer) return;

  settled = false;
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/cards/${card.id}/requirements/respond`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      }
    );
    const result = (await response.json()) as {
      question?: string;
      complete?: boolean;
      draftRequirements?: string;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(result.error ?? "Could not continue card refinement");
    }
    draftRequirements = result.draftRequirements ?? draftRequirements;
    input = "";
    if (result.complete) {
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
    settled = true;
  }
}

async function confirmReady() {
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/cards/${card.id}/requirements/approve`,
      {
        method: "POST",
      }
    );
    const result = parsePlanningProposalResponse(await response.json());
    if (result.feedback) {
      onRequirementsFeedback?.(result.feedback);
      onCancel();
      return;
    }
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

$effect(() => {
  const update = projectSocket.draftUpdate;
  if (settled || !update || update.cardId !== card.id) return;
  draftRequirements = update.content;
});
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
      <div class="confirmation-title">
        Card and requirements ready to approve
      </div>
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
    <Textarea
      bind:value={input}
      placeholder={stage === "context" ? "Add context..." : "Your answer..."}
      disabled={busy}
      restProps={{ rows: "3" }}
    />
  {/if}

  <div class="actions">
    {#if stage === "context"}
      <Button
        variant="mint"
        onclick={startRefinement}
        disabled={busy || !input.trim()}
      >
        {busy ? "Starting..." : "Start refinement"}
      </Button>
    {:else if stage === "question"}
      <Button variant="mint" onclick={respond} disabled={busy || !input.trim()}>
        {busy ? "Sending..." : "Send"}
      </Button>
    {:else}
      <Button variant="mint" onclick={confirmReady} disabled={busy}>
        {busy ? "Reconciling..." : "Confirm and review changes"}
      </Button>
    {/if}
    <Button variant="platinum" onclick={onCancel} disabled={busy}>
      {stage === "confirmation" ? "Keep as Idea" : "Cancel"}
    </Button>
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
}

.prompt,
.confirmation {
  white-space: normal;
}

.question {
  overflow-wrap: anywhere;
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

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
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
