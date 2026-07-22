<script lang="ts">
import type {
  Card,
  CardActivityEvent,
  Column,
  PlanningProposal,
  ReviewReadiness,
  RequirementsFeedback,
} from "shared/board-types";
import CardRefinement from "./card-refinement.svelte";

let {
  projectId,
  card,
  reviewReadiness,
  initialRefinementQuestion,
  onClose,
  onCardUpdated,
  onPlanningProposal,
  onRequirementsFeedback,
  onRun,
  onAccept,
  onRequestChanges,
  onRestartReview,
  onRemediate,
}: Props = $props();

type Props = {
  projectId: string;
  card: Card;
  reviewReadiness?: ReviewReadiness;
  initialRefinementQuestion?: string | null;
  onClose: () => void;
  onCardUpdated: (card: Card) => void;
  onPlanningProposal?: (proposal: PlanningProposal) => void;
  onRequirementsFeedback?: (feedback: RequirementsFeedback) => void;
  onRun?: () => void;
  onAccept?: () => Promise<void>;
  onRequestChanges?: (guidance: string) => Promise<void>;
  onRestartReview?: () => Promise<void>;
  onRemediate?: (
    action: "retry_with_patch" | "redevise" | "archive",
    suggestionId?: string
  ) => Promise<void>;
};

let refining = $state(false);
let consumedInitialQuestion = $state("");
let requestingChanges = $state(false);
let decisionGuidance = $state("");
let decisionError = $state<string | null>(null);
let deciding = $state(false);
let activity = $state<CardActivityEvent[]>([]);
let activityError = $state<string | null>(null);
let remediating = $state(false);
let remediationError = $state<string | null>(null);

async function loadActivity() {
  activityError = null;
  try {
    const response = await fetch(
      `/api/queen-bee/${projectId}/cards/${card.id}/activity`
    );
    const result = (await response.json()) as {
      activity?: CardActivityEvent[];
      error?: string;
    };
    if (!response.ok)
      throw new Error(result.error ?? "Could not load activity");
    activity = result.activity ?? [];
  } catch (error) {
    activityError =
      error instanceof Error ? error.message : "Could not load activity";
  }
}

$effect(() => {
  card.workerLog?.iterations;
  card.reviewerLog?.reviewedAt;
  card.workAttempts?.at(-1)?.status;
  void loadActivity();
});

async function acceptWork() {
  if (!onAccept) return;
  await runDecision(onAccept, "Could not accept work");
}

async function runDecision(
  action: () => Promise<void>,
  failureMessage: string
): Promise<boolean> {
  deciding = true;
  decisionError = null;
  try {
    await action();
    return true;
  } catch (error) {
    decisionError = error instanceof Error ? error.message : failureMessage;
    return false;
  } finally {
    deciding = false;
  }
}

async function requestChanges() {
  const guidance = decisionGuidance.trim();
  if (!onRequestChanges || !guidance) return;
  deciding = true;
  decisionError = null;
  try {
    await onRequestChanges(guidance);
    requestingChanges = false;
    decisionGuidance = "";
  } catch (error) {
    decisionError =
      error instanceof Error ? error.message : "Could not request changes";
  } finally {
    deciding = false;
  }
}

async function restartReview() {
  if (!onRestartReview) return;
  deciding = true;
  decisionError = null;
  try {
    await onRestartReview();
  } catch (error) {
    decisionError =
      error instanceof Error ? error.message : "Could not restart review";
  } finally {
    deciding = false;
  }
}

async function remediate(
  action: "retry_with_patch" | "redevise" | "archive",
  suggestionId: string
) {
  if (!onRemediate || remediating) return;
  remediating = true;
  remediationError = null;
  try {
    await onRemediate(action, suggestionId);
  } catch (error) {
    remediationError =
      error instanceof Error ? error.message : "Could not apply remediation";
  } finally {
    remediating = false;
  }
}

$effect(() => {
  if (
    initialRefinementQuestion &&
    initialRefinementQuestion !== consumedInitialQuestion
  ) {
    consumedInitialQuestion = initialRefinementQuestion;
    refining = true;
  }
});

const COLUMN_LABELS: Record<Column, string> = {
  ready: "Ready",
  in_progress: "In Progress",
  reviewing: "Reviewing",
  done: "Done",
  unfulfillable: "Unfulfillable",
};
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" onclick={(e) => e.stopPropagation()}>
    <div class="panel-header">
      <h3>{card.title}</h3>
      <button class="btn-close" onclick={onClose}>&times;</button>
    </div>

    <div class="panel-body">
      <div class="section">
        <div class="section-label">Status</div>
        <div class="section-value">{COLUMN_LABELS[card.column]}</div>
      </div>

      <div class="section">
        <div class="section-label">Description</div>
        <div class="section-value">{card.description || "No description"}</div>
      </div>

      {#if card.acceptanceCriteria.length > 0}
        <div class="section">
          <div class="section-label">Acceptance Criteria</div>
          <ul class="criteria-list">
            {#each card.acceptanceCriteria as criterion}
              <li>{criterion}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if card.relevantFiles.length > 0}
        <div class="section">
          <div class="section-label">Relevant Files</div>
          <div class="file-list">
            {#each card.relevantFiles as file}
              <code class="file">{file}</code>
            {/each}
          </div>
        </div>
      {/if}

      {#if card.dependencies.length > 0}
        <div class="section">
          <div class="section-label">Dependencies</div>
          <div class="deps-list">
            {#each card.dependencies as dep}
              <span class="dep">{dep}</span>
            {/each}
          </div>
        </div>
      {/if}

      {#if card.workerLog}
        <div class="section">
          <div class="section-label">Last Run</div>
          <div class="log-summary">
            {card.workerLog.iterations} iteration{card.workerLog.iterations !== 1 ? "s" : ""},
            {card.workerLog.toolCalls.length} tool call{card.workerLog.toolCalls.length !== 1 ? "s" : ""}
            {#if card.workerLog.error}
              <span class="log-error">— Failed: {card.workerLog.error}</span>
            {/if}
          </div>
          {#if card.workerLog.toolCalls.length > 0}
            <div class="log-tools">
              {#each card.workerLog.toolCalls as tc}
                <span class="log-tool">{tc.name}</span>
              {/each}
            </div>
          {/if}
          {#if card.workerLog.content}
            <pre class="log-content">{card.workerLog.content.slice(-2000)}</pre>
          {/if}
        </div>
      {/if}

      {#if card.reviewerLog}
        <div class="section">
          <div class="section-label">Review Package</div>
          <div
            class="review-verdict"
            class:verdict-approved={card.reviewerLog.verdict === "approved"}
            class:verdict-changes={card.reviewerLog.verdict === "changes_requested"}
            class:verdict-error={card.reviewerLog.status === "error"}
          >
            {card.reviewerLog.status === "error"
              ? "Review error"
              : card.reviewerLog.verdict === "approved"
                ? "Approved"
                : "Changes requested"}
          </div>
          {#if card.reviewerLog.error}
            <div class="review-feedback">{card.reviewerLog.error}</div>
          {/if}
          {#each card.reviewerLog.findings ?? [] as finding}
            <div class="review-finding">
              <div class="review-finding-header">
                {finding.severity}: {finding.requirement}
              </div>
              <div>{finding.evidence}</div>
              <div class="review-recommendation">{finding.recommendation}</div>
            </div>
          {/each}
          {#if card.reviewerLog.verificationAssessment}
            <div class="review-assessment">
              Verification {card.reviewerLog.verificationAssessment.status}:
              {card.reviewerLog.verificationAssessment.notes}
            </div>
          {/if}
        </div>
      {/if}

      {#if card.column === "reviewing"}
        <div class="section review-readiness">
          <div class="section-label">Integration readiness</div>
          {#if !reviewReadiness}
            <div class="section-value">Checking hive-main…</div>
          {:else}
            <div
              class="readiness-message"
              class:readiness-current={reviewReadiness.state === "current"}
              class:readiness-warning={reviewReadiness.state === "stale"}
              class:readiness-conflict={reviewReadiness.state === "conflicted" || reviewReadiness.state === "dirty" || reviewReadiness.state === "branch_changed" || reviewReadiness.state === "error"}
            >
              {reviewReadiness.message}
            </div>
            {#if reviewReadiness.conflictingFiles.length > 0}
              <div class="file-list">
                {#each reviewReadiness.conflictingFiles as file}
                  <code class="file">{file}</code>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/if}

      {#if activity.length > 0 || activityError}
        <div class="section">
          <div class="section-label">Activity</div>
          {#if activityError}
            <div class="log-error">{activityError}</div>
          {/if}
          <div class="activity-list">
            {#each activity as event}
              <div class="activity-event" class:activity-error={event.type === "error"}>
                <div class="activity-summary">
                  <span class="activity-actor">{event.actor}</span>
                  <span>{event.summary}</span>
                </div>
                {#if event.detail}
                  <details>
                    <summary>Diagnostics</summary>
                    <pre>{event.detail}</pre>
                  </details>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if card.handover}
        <div class="section handover">
          <div class="section-label">Worker Handover</div>
          <div class="handover-problem">{card.handover.problem}</div>
          {#if card.handover.attempted.length > 0}
            <div class="handover-label">Attempted</div>
            <ul class="criteria-list">
              {#each card.handover.attempted as attempt}
                <li>{attempt}</li>
              {/each}
            </ul>
          {/if}
          {#if card.handover.blockedBy.length > 0}
            <div class="handover-label">Blocked by</div>
            <ul class="criteria-list">
              {#each card.handover.blockedBy as blocker}
                <li>{blocker}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      {#if card.coordinatorLog}
        <div class="section">
          <div class="section-label">Coordinator</div>
          {#if card.coordinatorLog.status === "pending"}
            <div class="section-value">Analyzing the handover…</div>
          {:else if card.coordinatorLog.status === "error"}
            <div class="log-error">{card.coordinatorLog.error ?? "Analysis failed"}</div>
          {:else}
            <div class="section-value">{card.coordinatorLog.summary}</div>
            {#if remediationError}<div class="log-error">{remediationError}</div>{/if}
            {#each card.coordinatorLog.suggestions ?? [] as suggestion}
              <div class="suggestion">
                <div>{suggestion.rationale}</div>
                {#if onRemediate}
                  <button
                    class="btn btn-sm"
                    onclick={() => void remediate(suggestion.action, suggestion.id)}
                    disabled={remediating}
                  >
                    {remediating
                      ? "Preparing…"
                      : suggestion.action === "retry_with_patch"
                      ? "Accept patch"
                      : suggestion.action === "redevise"
                        ? "Revise requirements"
                        : "Archive"}
                  </button>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/if}

      {#if refining}
        <CardRefinement
          {projectId}
          {card}
          {onCardUpdated}
          {onPlanningProposal}
          {onRequirementsFeedback}
          initialQuestion={initialRefinementQuestion}
          onCancel={() => (refining = false)}
        />
      {/if}

      {#if requestingChanges}
        <div class="section decision-input">
          <div class="section-label">Guidance for the next attempt</div>
          <textarea
            bind:value={decisionGuidance}
            rows="3"
            placeholder="What should the Worker Agent change?"
            disabled={deciding}
          ></textarea>
          <div class="decision-input-actions">
            <button
              class="btn btn-run"
              onclick={requestChanges}
              disabled={deciding || !decisionGuidance.trim()}
            >
              Request changes
            </button>
            <button
              class="btn"
              onclick={() => (requestingChanges = false)}
              disabled={deciding}
            >Cancel</button>
          </div>
        </div>
      {/if}

      {#if decisionError}
        <div class="log-error">{decisionError}</div>
      {/if}
    </div>

    <div class="panel-actions">
      {#if card.column === "ready" && onRun}
        <button class="btn btn-run" onclick={onRun}>
          Run Worker Agent
        </button>
      {/if}
      {#if card.column === "reviewing"}
        {#if card.reviewerLog?.status === "complete"}
          {#if reviewReadiness?.canAccept && onAccept}
            <button class="btn btn-run" onclick={acceptWork} disabled={deciding}>
              {deciding ? "Applying decision..." : "Accept work"}
            </button>
          {:else if reviewReadiness?.canRefreshReview && onRestartReview}
            <button class="btn btn-run" onclick={restartReview} disabled={deciding}>
              {deciding ? "Refreshing..." : "Refresh review"}
            </button>
          {/if}
        {:else if card.reviewerLog?.status === "error" && onRestartReview}
          <button class="btn btn-run" onclick={restartReview} disabled={deciding}>
            {deciding ? "Restarting..." : "Retry review"}
          </button>
        {/if}
        {#if onRequestChanges && !requestingChanges}
          <button
            class="btn"
            onclick={() => (requestingChanges = true)}
            disabled={deciding}
          >Request changes</button>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .panel {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: 520px;
    max-width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
  }

  .panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 1.25rem 1.25rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .panel-header h3 {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .btn-close {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .btn-close:hover {
    color: var(--text);
  }

  .panel-body {
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .section-label {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }

  .section-value {
    font-size: 0.8125rem;
    color: var(--text);
    line-height: 1.5;
  }

  .criteria-list {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.8125rem;
    color: var(--text);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .file-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .file {
    font-size: 0.6875rem;
    background: var(--bg);
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    color: var(--accent);
    font-family: var(--font-mono, monospace);
  }

  .deps-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .dep {
    font-size: 0.6875rem;
    background: var(--bg);
    color: var(--muted);
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
  }

  .panel-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.75rem 1.25rem 1rem;
    border-top: 1px solid var(--border);
  }

  .btn {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.6875rem;
    cursor: pointer;
    background: var(--surface);
    color: var(--text);
  }

  .btn:hover {
    background: var(--border);
  }

  .btn-run {
    background: var(--accent);
    color: #1b1601;
    border-color: var(--accent);
    font-weight: 600;
    padding: 0.5rem 1.25rem;
  }

  .log-summary {
    font-size: 0.75rem;
    color: var(--text);
  }

  .log-error {
    color: #dc3c3c;
  }

  .log-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.375rem;
  }

  .log-tool {
    font-size: 0.625rem;
    background: var(--bg);
    color: var(--accent);
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-family: var(--font-mono, monospace);
  }

  .log-content {
    font-size: 0.6875rem;
    font-family: var(--font-mono, monospace);
    color: var(--muted);
    white-space: pre-wrap;
    margin: 0.5rem 0 0 0;
    max-height: 200px;
    overflow-y: auto;
    line-height: 1.45;
  }

  .review-verdict {
    font-size: 0.75rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .verdict-approved {
    color: #7cb342;
  }

  .verdict-changes,
  .verdict-error {
    color: #dc3c3c;
  }

  .review-feedback {
    font-size: 0.75rem;
    color: var(--text);
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .review-finding {
    border-left: 2px solid var(--border);
    color: var(--text);
    font-size: 0.75rem;
    line-height: 1.45;
    margin-top: 0.5rem;
    padding-left: 0.5rem;
  }

  .review-finding-header {
    font-weight: 600;
    text-transform: capitalize;
  }

  .review-recommendation,
  .review-assessment {
    color: var(--muted);
    font-size: 0.6875rem;
    margin-top: 0.25rem;
  }

  .readiness-message {
    border-left: 2px solid var(--border);
    color: var(--muted);
    font-size: 0.75rem;
    line-height: 1.45;
    padding-left: 0.5rem;
  }

  .readiness-current {
    border-left-color: #7cb342;
    color: #7cb342;
  }

  .readiness-warning {
    border-left-color: #c89522;
    color: #c89522;
  }

  .readiness-conflict {
    border-left-color: #dc3c3c;
    color: #dc3c3c;
  }

  .decision-input textarea {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    box-sizing: border-box;
    color: var(--text);
    font-family: inherit;
    font-size: 0.75rem;
    padding: 0.5rem;
    resize: vertical;
    width: 100%;
  }

  .decision-input-actions {
    display: flex;
    gap: 0.375rem;
    margin-top: 0.5rem;
  }

  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .activity-event {
    border-left: 2px solid var(--border);
    color: var(--text);
    font-size: 0.6875rem;
    padding-left: 0.5rem;
  }

  .activity-error {
    border-left-color: #dc3c3c;
  }

  .activity-summary {
    display: flex;
    gap: 0.375rem;
  }

  .activity-actor {
    color: var(--accent);
    font-weight: 600;
    text-transform: capitalize;
  }

  .activity-event details {
    color: var(--muted);
    margin-top: 0.25rem;
  }

  .activity-event pre {
    font-family: var(--font-mono, monospace);
    font-size: 0.625rem;
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
  }

  .handover-problem {
    font-size: 0.8125rem;
    color: var(--text);
  }

  .handover-label {
    color: var(--muted);
    font-size: 0.6875rem;
    margin-top: 0.5rem;
  }

  .suggestion {
    align-items: center;
    border-top: 1px solid var(--border);
    color: var(--text);
    display: flex;
    font-size: 0.75rem;
    gap: 0.5rem;
    justify-content: space-between;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
  }

</style>
