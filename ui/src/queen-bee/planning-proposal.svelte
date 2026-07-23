<script lang="ts">
import type {
  PlanningProposal,
  RequirementsFeedback,
} from "shared/board-types";
import { isRecord } from "shared/board-types";
import { parsePlanningProposalResponse } from "./parse-planning-proposal-response";

let {
  projectId,
  proposal,
  onApplied,
  onDiscard,
  onRequirementsFeedback,
  onRequirementsRevisionStarted,
}: Props = $props();

type Props = {
  projectId: string;
  proposal: PlanningProposal;
  onApplied: () => void;
  onDiscard: () => void;
  onRequirementsFeedback: (feedback: RequirementsFeedback) => void;
  onRequirementsRevisionStarted: () => void;
};

let updatedProposal = $state<PlanningProposal | null>(null);
let current = $derived(updatedProposal ?? proposal);
let busy = $state(false);
let error = $state<string | null>(null);
let stale = $state(false);
let revisionGuidance = $state("");
let isInitialPlan = $derived(current.runKind === "initial_planning");

async function decide(changeId: string, decision: "accepted" | "rejected") {
  busy = true;
  error = null;
  stale = false;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/planning/${current.id}/changes/${changeId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      }
    );
    const result = parsePlanningProposalResponse(await response.json());
    if (!response.ok || !result.proposal) {
      throw new Error(result.error ?? "Could not save planning decision");
    }
    updatedProposal = result.proposal;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Planning failed";
    stale = /changed after planning started/i.test(error);
  } finally {
    busy = false;
  }
}

async function finish(action: "accept-all" | "apply") {
  busy = true;
  error = null;
  stale = false;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/planning/${current.id}/${action}`,
      { method: "POST" }
    );
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(result.error ?? "Could not apply planning proposal");
    }
    onApplied();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Planning failed";
    stale = /changed after planning started/i.test(error);
  } finally {
    busy = false;
  }
}

function allAccepted() {
  return current.changes.every((change) => change.decision === "accepted");
}

function hasRejected() {
  return current.changes.some((change) => change.decision === "rejected");
}

async function replanCards() {
  const guidance = revisionGuidance.trim();
  if (!guidance) return;
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/planning/${current.id}/replan`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guidance }),
      }
    );
    const result = parsePlanningProposalResponse(await response.json());
    if (result.feedback) {
      onRequirementsFeedback(result.feedback);
      return;
    }
    if (!response.ok || !result.proposal) {
      throw new Error(result.error ?? "Could not replan Cards");
    }
    updatedProposal = result.proposal;
    revisionGuidance = "";
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not replan Cards";
  } finally {
    busy = false;
  }
}

async function reviseRequirements() {
  const guidance = revisionGuidance.trim();
  if (!guidance) return;
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/requirements/revision/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: guidance, proposalId: current.id }),
      }
    );
    const value: unknown = await response.json();
    if (!response.ok) {
      throw new Error(
        isRecord(value) && typeof value.error === "string"
          ? value.error
          : "Could not start Requirements Revision"
      );
    }
    onRequirementsRevisionStarted();
  } catch (caught) {
    error =
      caught instanceof Error
        ? caught.message
        : "Could not start Requirements Revision";
  } finally {
    busy = false;
  }
}

async function cancelProposal() {
  busy = true;
  error = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/planning/${current.id}/cancel`,
      { method: "POST" }
    );
    const value: unknown = await response.json();
    if (!response.ok) {
      throw new Error(
        isRecord(value) && typeof value.error === "string"
          ? value.error
          : "Could not cancel Planning Proposal"
      );
    }
    onDiscard();
  } catch (caught) {
    error =
      caught instanceof Error
        ? caught.message
        : "Could not cancel Planning Proposal";
  } finally {
    busy = false;
  }
}
</script>

<div class="proposal">
  <div class="proposal-header">
    <div>
      <h2>
        {isInitialPlan ? "Review project plan" : "Review requirements and Card changes"}
      </h2>
      <p>
        {isInitialPlan
          ? "Review the proposed project requirements and Ready Cards before they become authoritative."
          : "Review the proposed requirements and their corresponding Card changes as one consistent update."}
      </p>
    </div>
    <button
      type="button"
      class="btn btn-primary"
      onclick={() => finish("accept-all")}
      disabled={busy}
    >
      {isInitialPlan ? "Accept plan" : "Accept and apply all"}
    </button>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <section class="requirements-preview">
    <h3>Proposed requirements</h3>
    <pre>{current.proposedRequirements}</pre>
  </section>

  <div class="changes">
    <h3>Card changes</h3>
    {#each current.changes as change (change.id)}
      <div class="change">
        <div class="change-heading">
          <span class="action action-{change.action}">{change.action}</span>
          <strong
            >{change.proposedCard?.title ?? change.cardId ?? "Card"}</strong
          >
          <span class="decision">{change.decision}</span>
        </div>
        <p>{change.rationale}</p>
        {#if change.proposedCard}
          <div class="card-preview">
            <div>{change.proposedCard.description}</div>
            <div>
              {change.proposedCard.acceptanceCriteria.length}
              acceptance criteria
            </div>
            <div>{change.proposedCard.relevantFiles.join(", ")}</div>
          </div>
        {/if}
        {#if change.action !== "keep" || change.resolvesSourceIdea}
          <div class="actions">
            <button
              type="button"
              class="btn"
              class:selected={change.decision === "accepted"}
              onclick={() => decide(change.id, "accepted")}
              disabled={busy}
            >
              Accept
            </button>
            <button
              type="button"
              class="btn"
              class:selected={change.decision === "rejected"}
              onclick={() => decide(change.id, "rejected")}
              disabled={busy}
            >
              Reject
            </button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="proposal-footer">
    {#if stale}
      <div class="revision-choice">
        <div>
          This proposal is stale because the project changed while it was being
          prepared. Discard it to return to the current Board.
        </div>
        <div class="actions">
          <button
            type="button"
            class="btn"
            onclick={cancelProposal}
            disabled={busy}
          >
            Discard stale proposal
          </button>
        </div>
      </div>
    {:else if hasRejected()}
      <div class="revision-choice">
        <textarea
          bind:value={revisionGuidance}
          rows="2"
          placeholder="What should change?"
          disabled={busy}
        ></textarea>
        <div class="actions">
          <button
            type="button"
            class="btn btn-primary"
            onclick={replanCards}
            disabled={busy || !revisionGuidance.trim()}
          >
            Replan Cards
          </button>
          <button
            type="button"
            class="btn"
            onclick={reviseRequirements}
            disabled={busy || !revisionGuidance.trim()}
          >
            Revise requirements
          </button>
          <button
            type="button"
            class="btn"
            onclick={cancelProposal}
            disabled={busy}
          >
            Cancel proposal
          </button>
        </div>
      </div>
    {:else}
      <button
        type="button"
        class="btn btn-primary"
        onclick={() => finish("apply")}
        disabled={busy || !allAccepted()}
      >
        Apply accepted changes
      </button>
      <button
        type="button"
        class="btn"
        onclick={cancelProposal}
        disabled={busy}
      >
        Cancel proposal
      </button>
      {#if !allAccepted()}
        <span>Accept every changed card before applying.</span>
      {/if}
    {/if}
  </div>
</div>

<style>
.proposal {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.proposal-header,
.change-heading,
.proposal-footer,
.actions {
  align-items: center;
  display: flex;
  gap: 0.5rem;
}
.proposal-header {
  justify-content: space-between;
}
h2 {
  color: var(--text);
  font-size: 1rem;
  margin: 0;
}
h3 {
  color: var(--text);
  font-size: 0.75rem;
  margin: 0;
}
p {
  color: var(--muted);
  font-size: 0.75rem;
  margin: 0.25rem 0 0;
}
.changes {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}
.requirements-preview {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.requirements-preview pre {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--text);
  font: inherit;
  font-size: 0.6875rem;
  line-height: 1.5;
  margin: 0;
  max-height: 24rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
}
.change {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 0.75rem;
}
.change-heading strong {
  color: var(--text);
  font-size: 0.8125rem;
}
.action,
.decision {
  color: var(--muted);
  font-size: 0.625rem;
  text-transform: uppercase;
}
.action-create {
  color: #7cb342;
}
.action-update {
  color: var(--accent);
}
.action-remove {
  color: #dc3c3c;
}
.decision {
  margin-left: auto;
}
.card-preview {
  color: var(--text);
  font-size: 0.6875rem;
  line-height: 1.5;
  margin-top: 0.5rem;
}
.actions {
  margin-top: 0.5rem;
}
.btn {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text);
  cursor: pointer;
  font-size: 0.6875rem;
  padding: 0.375rem 0.625rem;
}
.btn:disabled {
  cursor: default;
  opacity: 0.5;
}
.btn-primary,
.selected {
  background: var(--accent);
  border-color: var(--accent);
  color: #1b1601;
}
.proposal-footer {
  color: var(--muted);
  font-size: 0.6875rem;
}
.revision-choice {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.5rem;
}
textarea {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text);
  font: inherit;
  padding: 0.5rem;
  resize: vertical;
}
.error {
  color: #dc3c3c;
  font-size: 0.75rem;
}
</style>
