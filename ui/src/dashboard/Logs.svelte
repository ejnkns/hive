<script lang="ts">
import type { LogEntry } from "shared/logger";
import Button from "../shared/ui/Button.svelte";

let { entries = $bindable([] as LogEntry[]) } = $props();

let autoScroll = $state(true);
let open = $state(false);
let logContainer = $state<HTMLDivElement | undefined>();

function clearLogs() {
  entries = [];
}

$effect(() => {
  if (autoScroll && logContainer) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
});
</script>

<div class="log-panel">
  <div class="log-header">
    <Button
      variant="neutral"
      size="small"
      class="log-toggle"
      onclick={() => (open = !open)}
    >
      <span class="log-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
      <span>console stream</span>
      <span class="log-count">{entries.length} lines</span>
    </Button>
    <div class="controls">
      <Button
        variant={autoScroll ? "success" : "neutral"}
        onclick={() => (autoScroll = !autoScroll)}
      >
        Auto-scroll {autoScroll ? 'on' : 'off'}
      </Button>
      <Button variant="neutral" onclick={clearLogs}> clear </Button>
    </div>
  </div>
  {#if open}
    <div class="log-lines" bind:this={logContainer}>
      {#each entries as entry}
        <div class="log-line {entry.level}">
          <span class="log-time"
            >[{new Date(entry.timestamp).toLocaleTimeString()}]</span
          >
          <span class="log-level">[bzz:{entry.level}]</span>
          <span class="log-msg">{entry.message}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
.log-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.375rem 0.75rem;
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--muted);
}
:global(.log-toggle) {
  background: none;
  border: none;
  padding: 0;
  color: var(--muted);
}
:global(.log-toggle:hover) {
  color: var(--text);
  background: none;
  border-color: transparent;
}
.log-chevron {
  font-size: var(--text-xs);
}
.log-count {
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--muted);
}
.controls {
  display: flex;
  gap: 0.5rem;
}
.log-lines {
  padding: 0.5rem;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  border-top: 1px solid var(--border);
}
.log-line {
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.3;
}
.log-time {
  color: var(--muted);
}
.log-level {
  font-weight: bold;
}
.info .log-level {
  color: var(--text);
}
.warn .log-level {
  color: var(--warning);
}
.error .log-level {
  color: var(--error);
}
.debug .log-level {
  color: var(--muted);
}
.info {
  color: var(--text);
}
.warn {
  color: var(--warning);
}
.error {
  color: var(--error);
}
.debug {
  color: var(--muted);
}
</style>
