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

function toggle() {
  open = !open;
}
</script>

<div class="drawer" class:open>
  <button class="handle" onclick={toggle}>
    <span class="handle-bar"></span>
    {#if title}
      <span class="handle-title">{title}</span>
    {/if}
  </button>
  <div class="body">
    <div class="body-inner">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .drawer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 50;
    transform: translateY(calc(100% - 2rem));
    transition: transform 0.3s ease;
  }
  .drawer.open {
    transform: translateY(0);
  }
  .handle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 1.25rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: 8px 8px 0 0;
    cursor: pointer;
    color: var(--muted);
    font-family: inherit;
  }
  .handle:hover {
    color: var(--text);
  }
  .handle-bar {
    width: 2rem;
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    flex-shrink: 0;
  }
  .open .handle-bar {
    background: var(--accent);
  }
  .handle-title {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }
  .body {
    background: var(--card);
    border-top: 1px solid var(--border);
    max-height: 60vh;
    overflow-y: auto;
  }
  .body-inner {
    padding: 1rem 1.25rem;
    max-width: 1200px;
    margin: 0 auto;
  }
</style>
