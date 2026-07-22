<script lang="ts">
import type { SessionStage } from "shared/dashboard-types";
import { isTerminal, STAGE_LABELS } from "./stage-utils";

let { path = [] as SessionStage[], showSectionTitle = false } = $props();
</script>

{#if path.length > 0}
  {#if showSectionTitle}
    <div class="detail-section">
      <div class="section-title">stage path</div>
      <div class="path-dots">
        {#each path as stage, si}
          {#if si > 0}
            <span class="dot-line dot-line-filled"></span>
          {/if}
          <span class="dot-wrapper">
            <span
              class="dot"
              class:dot-error={stage === "failed"}
              class:dot-complete={stage === "complete"}
              class:dot-active={si === path.length - 1 && !isTerminal(stage)}
              class:dot-filled={si < path.length - 1 || isTerminal(stage)}
            ></span>
            <span class="dot-label">{STAGE_LABELS[stage]}</span>
          </span>
        {/each}
      </div>
    </div>
  {:else}
    <div class="path-dots">
      {#each path as stage, si}
        <span class="dot-wrapper">
          <span
            class="dot"
            class:dot-error={stage === "failed"}
            class:dot-complete={stage === "complete"}
            class:dot-active={si === path.length - 1 && !isTerminal(stage)}
            class:dot-filled={si < path.length - 1 || isTerminal(stage)}
          ></span>
          <span class="dot-label">{STAGE_LABELS[stage]}</span>
        </span>
        {#if si < path.length - 1}
          <span class="dot-line dot-line-filled"></span>
        {/if}
      {/each}
    </div>
  {/if}
{/if}

<style>
  .detail-section {
    margin-bottom: 0.75rem;
  }

  .section-title {
    font-size: 0.5625rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }

  .path-dots {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .dot-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .dot-filled {
    background: var(--success);
  }

  .dot-complete {
    background: var(--success);
  }

  .dot-error {
    background: var(--error);
  }

  .dot-active {
    background: var(--success);
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  .dot-label {
    font-size: 0.4375rem;
    color: var(--muted);
    text-transform: uppercase;
    text-align: center;
  }

  .dot-line {
    width: 12px;
    height: 1px;
    background: var(--border);
    margin-bottom: 10px;
  }

  .dot-line-filled {
    background: var(--success);
  }
</style>
