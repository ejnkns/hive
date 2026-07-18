<script lang="ts">
import type { PlanningProposal } from "shared/board-types";
import { parsePlanningProposalResponse } from "./parse-planning-proposal-response";

let { projectId, proposal, onApplied, onDiscard }: Props = $props();

type Props = {
  projectId: string;
  proposal: PlanningProposal;
  onApplied: () => void;
  onDiscard: () => void;
};

let updatedProposal = $state<PlanningProposal | null>(null);
let current = $derived(updatedProposal ?? proposal);
let busy = $state(false);
let error = $state<string | null>(null);

async function decide(changeId: string, decision: "accepted" | "rejected") {
  busy = true;
  error = null;
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
  } finally {
    busy = false;
  }
}

async function finish(action: "accept-all" | "apply") {
  busy = true;
  error = null;
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
</script>

<div class="proposal">
  <div class="proposal-header">
    <div>
      <h2>Review card reconciliation</h2>
      <p>The Planner Agent compared every card with the approved requirements.</p>
    </div>
    <button class="btn btn-primary" onclick={() => finish("accept-all")} disabled={busy}>
      Accept all
    </button>
  </div>

  {#if error}<div class="error">{error}</div>{/if}

  <div class="changes">
    {#each current.changes as change (change.id)}
      <div class="change">
        <div class="change-heading">
          <span class="action action-{change.action}">{change.action}</span>
          <strong>{change.proposedCard?.title ?? change.cardId ?? "Card"}</strong>
          <span class="decision">{change.decision}</span>
        </div>
        <p>{change.rationale}</p>
        {#if change.proposedCard}
          <div class="card-preview">
            <div>{change.proposedCard.description}</div>
            <div>{change.proposedCard.acceptanceCriteria.length} acceptance criteria</div>
            <div>{change.proposedCard.relevantFiles.join(", ")}</div>
          </div>
        {/if}
        {#if change.action !== "keep"}
          <div class="actions">
            <button
              class="btn"
              class:selected={change.decision === "accepted"}
              onclick={() => decide(change.id, "accepted")}
              disabled={busy}
            >Accept</button>
            <button
              class="btn"
              class:selected={change.decision === "rejected"}
              onclick={() => decide(change.id, "rejected")}
              disabled={busy}
            >Reject</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="proposal-footer">
    {#if hasRejected()}
      <button class="btn" onclick={onDiscard} disabled={busy}>Return to revise</button>
      <span>Rejected card changes require a revised requirements proposal.</span>
    {:else}
      <button
        class="btn btn-primary"
        onclick={() => finish("apply")}
        disabled={busy || !allAccepted()}
      >Apply accepted changes</button>
      {#if !allAccepted()}<span>Accept every changed card before applying.</span>{/if}
    {/if}
  </div>
</div>

<style>
  .proposal { display: flex; flex-direction: column; gap: 1rem; }
  .proposal-header, .change-heading, .proposal-footer, .actions {
    align-items: center; display: flex; gap: 0.5rem;
  }
  .proposal-header { justify-content: space-between; }
  h2 { color: var(--text); font-size: 1rem; margin: 0; }
  p { color: var(--muted); font-size: 0.75rem; margin: 0.25rem 0 0; }
  .changes { display: flex; flex-direction: column; gap: 0.625rem; }
  .change { background: var(--card); border: 1px solid var(--border); border-radius: 7px; padding: 0.75rem; }
  .change-heading strong { color: var(--text); font-size: 0.8125rem; }
  .action, .decision { color: var(--muted); font-size: 0.625rem; text-transform: uppercase; }
  .action-create { color: #7cb342; }
  .action-update { color: var(--accent); }
  .action-remove { color: #dc3c3c; }
  .decision { margin-left: auto; }
  .card-preview { color: var(--text); font-size: 0.6875rem; line-height: 1.5; margin-top: 0.5rem; }
  .actions { margin-top: 0.5rem; }
  .btn { background: var(--surface); border: 1px solid var(--border); border-radius: 5px; color: var(--text); cursor: pointer; font-size: 0.6875rem; padding: 0.375rem 0.625rem; }
  .btn:disabled { cursor: default; opacity: 0.5; }
  .btn-primary, .selected { background: var(--accent); border-color: var(--accent); color: #1b1601; }
  .proposal-footer { color: var(--muted); font-size: 0.6875rem; }
  .error { color: #dc3c3c; font-size: 0.75rem; }
</style>
