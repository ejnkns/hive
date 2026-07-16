<script lang="ts">
import type { Card, Column } from "shared/board-types";

let { card, onClose, onMove }: Props = $props();

type Props = {
  card: Card;
  onClose: () => void;
  onMove: (column: Column) => void;
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
    </div>

    <div class="panel-actions">
      {#each ["idea", "ready", "in_progress", "reviewing", "done", "unfulfillable"] as col}
        {#if col !== card.column}
          <button class="btn btn-sm" onclick={() => onMove(col as Column)}>
            Move to {COLUMN_LABELS[col as Column]}
          </button>
        {/if}
      {/each}
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
</style>
