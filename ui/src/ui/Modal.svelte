<script lang="ts">
import type { Snippet } from "svelte";

let {
  open = $bindable(false),
  title = "",
  children,
}: {
  open?: boolean;
  title?: string;
  children: Snippet;
} = $props();

let backdrop = $state<HTMLDivElement>();

function close() {
  open = false;
}

function onBackdropClick(e: MouseEvent) {
  if (e.target === backdrop) close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}
</script>

{#if open}
  <div
    class="backdrop"
    bind:this={backdrop}
    onclick={onBackdropClick}
    onkeydown={onKeydown}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="overlay">
      {#if title}
        <div class="header">
          <span class="title">{title}</span>
          <button class="close-btn" onclick={close}>&times;</button>
        </div>
      {/if}
      <div class="content">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .overlay {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 1.25rem;
    max-width: 500px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 1rem;
    font-family: inherit;
    padding: 0;
    line-height: 1;
  }
  .close-btn:hover {
    color: var(--accent);
  }
  .content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
</style>
