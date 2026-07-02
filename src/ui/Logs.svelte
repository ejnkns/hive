<script lang="ts">
import type { LogEntry } from "../shared/logger";

let { entries = $bindable([] as LogEntry[]) } = $props();

let autoScroll = $state(true);
let logContainer: HTMLDivElement;

function clearLogs() {
  entries = [];
}

$effect(() => {
  if (autoScroll && logContainer) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
});
</script>

<div class="log-header">
  <span>Console Stream</span>
  <div class="controls">
    <button class="btn btn-scroll {autoScroll ? 'active' : ''}" onclick={() => autoScroll = !autoScroll}>
      Auto-scroll {autoScroll ? 'ON' : 'OFF'}
    </button>
    <button class="btn btn-clear" onclick={clearLogs}>Clear</button>
  </div>
</div>
<div class="log-lines" bind:this={logContainer}>
  {#each entries as entry}
    <div class="log-line {entry.level}">
      <span class="log-time">[{new Date(entry.timestamp).toLocaleTimeString()}]</span>
      <span class="log-level">[bzz:{entry.level}]</span>
      <span class="log-msg">{entry.message}</span>
    </div>
  {/each}
</div>

<style>
  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--card);
    padding: 0.375rem 0.75rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .controls { display: flex; gap: 0.5rem; }
  .btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    cursor: pointer;
    font-size: 0.625rem;
    padding: 0.125rem 0.375rem;
    font-family: inherit;
  }
  .btn:hover { color: var(--accent); border-color: var(--accent); }
  .btn.active { background: rgba(var(--accent-rgb), 0.1); color: var(--accent); border-color: var(--accent); }
  .log-lines {
    padding: 0.5rem;
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .log-line { white-space: pre-wrap; word-break: break-all; line-height: 1.3; }
  .log-time { color: var(--muted); }
  .log-level { font-weight: bold; }
  .info .log-level { color: var(--accent); }
  .warn .log-level { color: var(--warning); }
  .error .log-level { color: var(--error); }
  .debug .log-level { color: var(--muted); }
  .info { color: var(--text); }
  .warn { color: var(--warning); }
  .error { color: var(--error); }
  .debug { color: var(--muted); }
</style>
