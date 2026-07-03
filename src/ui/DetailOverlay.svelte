<script lang="ts">
import type { MetricData } from "./types";
import { formatNumber, formatTime } from "./utils";

let {
  detailMetric: metric = $bindable(null as MetricData | null),
  detailAllMetrics: allMetrics = $bindable([] as MetricData[]),
} = $props();

function close() {
  metric = null;
}

let backdrop = $state<HTMLDivElement>();
function onBackdropClick(e: MouseEvent) {
  if (e.target === backdrop) close();
}

const chain = $derived(
  metric && allMetrics.length > 0
    ? allMetrics
        .filter((m) => m.requestId === metric?.requestId)
        .sort((a, b) => a.timestamp - b.timestamp)
    : []
);
</script>

{#if metric}
  <div class="backdrop" bind:this={backdrop} onclick={onBackdropClick} onkeydown={(e) => e.key === 'Escape' && close()} role="dialog" aria-modal="true" tabindex="-1">
    <div class="overlay">
      <div class="header">
        <span class="title">Request Detail</span>
        <button class="close-btn" onclick={close}>&times;</button>
      </div>
      <div class="detail-grid">
        <div class="field"><span class="label">Request ID</span><span class="val mono">{metric.requestId}</span></div>
        <div class="field"><span class="label">Provider</span><span class="val">{metric.provider}</span></div>
        <div class="field"><span class="label">Model</span><span class="val mono">{metric.model}</span></div>
        <div class="field"><span class="label">Time</span><span class="val">{formatTime(metric.timestamp)}</span></div>
        <div class="field"><span class="label">TTFT</span><span class="val">{formatNumber(metric.ttft, "ms")}</span></div>
        <div class="field"><span class="label">Total</span><span class="val">{formatNumber(metric.totalLatency, "ms")}</span></div>
        <div class="field"><span class="label">Tokens I/O</span><span class="val">{metric.inputTokens ?? "—"} / {metric.outputTokens ?? "—"}</span></div>
        <div class="field"><span class="label">Thinking</span><span class="val">{metric.thinkingTime != null ? `{metric.thinkingTime}ms` : "—"}</span></div>
        <div class="field"><span class="label">Status</span><span class="val {metric.success ? 'ok' : 'err'}">{String(metric.statusCode)}</span></div>
        <div class="field"><span class="label">Finish</span><span class="val">{metric.finishReason ?? "—"}</span></div>
        <div class="field"><span class="label">Refused</span><span class="val">{metric.refused ? "Yes" : "No"}</span></div>
        <div class="field"><span class="label">Tool Err</span><span class="val">{metric.toolCallFailed ? "Yes" : "No"}</span></div>
        <div class="field"><span class="label">Source</span><span class="val">{metric.source}</span></div>
        {#if metric.errorBody}
          <div class="field full"><span class="label">Error</span><span class="val mono">{metric.errorBody}</span></div>
        {/if}
      </div>
      {#if chain.length > 0}
        <div class="chain-title">Request Chain ({chain.length} attempts)</div>
        {#each chain as m, idx}
          <div class="chain-item">
            <span class="chain-num">Attempt #{idx + 1}</span>
            <span class="chain-prov">{m.provider} ({m.model})</span>
            <span class="chain-status {m.success ? 'ok' : 'err'}">{m.statusCode ? String(m.statusCode) : "ERR"}{m.errorType ? ` ${m.errorType}` : ""}</span>
            <span class="chain-ttft">{formatNumber(m.ttft, "ms")}</span>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(0, 0, 0, 0.6);
    display: flex; align-items: center; justify-content: center;
  }
  .overlay {
    background: var(--card); border: 1px solid var(--border);
    padding: 1.25rem; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
  }
  .header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 0.75rem;
  }
  .title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; }
  .close-btn {
    background: none; border: none; color: var(--muted); cursor: pointer;
    font-size: 1rem; font-family: inherit;
  }
  .close-btn:hover { color: var(--accent); }
  .detail-grid {
    display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem;
    font-size: 0.75rem;
  }
  .field.full { grid-column: 1 / -1; }
  .label { color: var(--muted); }
  .val { color: var(--text); }
  .val.mono { font-family: monospace; font-size: 0.625rem; }
  .val.ok { color: var(--success); }
  .val.err { color: var(--error); }
  .chain-title {
    margin-top: 1rem; font-size: 0.6875rem; font-weight: 700;
    text-transform: uppercase; color: var(--muted);
    border-top: 1px solid var(--border); padding-top: 0.75rem;
  }
  .chain-item {
    display: flex; gap: 0.5rem; align-items: center;
    font-size: 0.6875rem; padding: 0.25rem 0;
  }
  .chain-num { color: var(--accent); font-weight: 700; }
  .chain-prov { font-family: monospace; font-size: 0.625rem; }
  .chain-status { font-weight: 700; }
  .chain-status.ok { color: var(--success); }
  .chain-status.err { color: var(--error); }
  .chain-ttft { color: var(--muted); }
</style>
