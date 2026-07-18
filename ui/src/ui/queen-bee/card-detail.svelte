<script lang="ts">
import type { Card, Column } from "shared/board-types";

let { card, onClose, onRun, onRemediate, onCardDevise }: Props = $props();

type Props = {
  card: Card;
  onClose: () => void;
  onRun?: () => void;
  onRemediate?: (
    action: "retry_with_patch" | "redevise" | "archive",
    suggestionId?: string
  ) => void;
  onCardDevise?: () => void;
};

const COLUMN_LABELS: Record<Column, string> = {
  idea: "Idea",
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
          <div class="section-label">Review</div>
          <div
            class="review-verdict"
            class:verdict-pass={card.reviewerLog.verdict === "pass"}
            class:verdict-fail={card.reviewerLog.verdict === "fail"}
          >
            {card.reviewerLog.verdict === "pass" ? "Passed" : "Failed"}
          </div>
          <div class="review-feedback">{card.reviewerLog.feedback}</div>
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
            {#each card.coordinatorLog.suggestions ?? [] as suggestion}
              <div class="suggestion">
                <div>{suggestion.rationale}</div>
                {#if onRemediate}
                  <button
                    class="btn btn-sm"
                    onclick={() => onRemediate(suggestion.action, suggestion.id)}
                  >
                    {suggestion.action === "retry_with_patch"
                      ? "Accept patch"
                      : suggestion.action === "redevise"
                        ? "Re-devise"
                        : "Archive"}
                  </button>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <div class="panel-actions">
      {#if card.column === "idea" && onCardDevise}
        <button class="btn btn-run" onclick={onCardDevise}>Refine card</button>
      {/if}
      {#if (card.column === "ready" || card.column === "in_progress") && onRun}
        <button class="btn btn-run" onclick={onRun}>
          {card.column === "in_progress" ? "Retry Worker" : "Run Worker"}
        </button>
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

  .verdict-pass {
    color: #7cb342;
  }

  .verdict-fail {
    color: #dc3c3c;
  }

  .review-feedback {
    font-size: 0.75rem;
    color: var(--text);
    line-height: 1.45;
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
