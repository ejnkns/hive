<script lang="ts">
import type { Card, ReviewReadiness } from "shared/board-types";

let { card, reviewReadiness, onSelect, onRun }: Props = $props();

type Props = {
  card: Card;
  reviewReadiness?: ReviewReadiness;
  onSelect: () => void;
  onRun?: () => void;
};
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="card" onclick={onSelect}>
  <div class="card-title">{card.title}</div>
  {#if card.column === "ready" && onRun}
    <button
      class="run"
      aria-label="Run worker"
      onclick={(event) => {
        event.stopPropagation();
        onRun?.();
      }}
    >
      Run
    </button>
  {/if}
  {#if card.description}
    <div class="card-desc">{card.description.slice(0, 80)}{card.description.length > 80 ? "..." : ""}</div>
  {/if}
  {#if card.dependencies.length > 0}
    <div class="card-deps">{card.dependencies.length} dep{card.dependencies.length > 1 ? "s" : ""}</div>
  {/if}
  {#if card.reviewerLog}
    <div
      class="card-review"
      class:review-approved={card.reviewerLog.verdict === "approved"}
      class:review-changes={card.reviewerLog.verdict === "changes_requested"}
      class:review-error={card.reviewerLog.status === "error"}
    >
      {card.reviewerLog.status === "error"
        ? "review error"
        : card.reviewerLog.verdict === "approved"
          ? "approved"
          : "changes"}
    </div>
  {/if}
  {#if reviewReadiness?.state === "stale"}
    <div class="card-integration stale">refresh review</div>
  {:else if reviewReadiness?.state === "conflicted"}
    <div class="card-integration conflicted">integration conflict</div>
  {:else if reviewReadiness?.state === "dirty" || reviewReadiness?.state === "branch_changed"}
    <div class="card-integration conflicted">branch changed</div>
  {/if}
</div>

<style>
  .card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.625rem 0.75rem;
    cursor: pointer;
    transition: border-color 0.15s;
    position: relative;
  }

  .card:hover {
    border-color: var(--accent);
  }

  .card-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text);
    line-height: 1.35;
  }

  .run {
    position: absolute;
    top: 0.45rem;
    right: 0.45rem;
    border: 0;
    border-radius: 4px;
    background: var(--accent);
    color: #1b1601;
    cursor: pointer;
    font-size: 0.625rem;
    line-height: 1;
    padding: 0.25rem 0.35rem;
  }

  .card-desc {
    font-size: 0.6875rem;
    color: var(--muted);
    margin-top: 0.25rem;
    line-height: 1.4;
  }

  .card-deps {
    font-size: 0.625rem;
    color: var(--accent);
    margin-top: 0.375rem;
  }

  .card-review {
    font-size: 0.5625rem;
    font-weight: 600;
    text-transform: uppercase;
    margin-top: 0.375rem;
  }

  .review-approved {
    color: #7cb342;
  }

  .review-changes,
  .review-error {
    color: #dc3c3c;
  }

  .card-integration {
    margin-top: 0.375rem;
    font-size: 0.5625rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .card-integration.stale {
    color: #c89522;
  }

  .card-integration.conflicted {
    color: #dc3c3c;
  }
</style>
