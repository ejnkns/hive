<script lang="ts">
import type { SessionState } from "./types";
import { formatNumber, formatTime, sc } from "./utils";

let {
  session,
  collapsed = false,
  onToggle,
}: {
  session: SessionState;
  collapsed?: boolean;
  onToggle?: () => void;
} = $props();

const STAGES: { key: string; label: string }[] = [
  { key: "received", label: "rec" },
  { key: "selection", label: "sel" },
  { key: "dispatched", label: "dis" },
  { key: "thinking", label: "thk" },
  { key: "streaming", label: "str" },
  { key: "tool_use", label: "too" },
  { key: "complete", label: "com" },
  { key: "failed", label: "err" },
];

const stageIndex = $derived(STAGES.findIndex((s) => s.key === session.stage));

let elapsedMs = $state(0);
let timer: ReturnType<typeof setInterval> | null = null;

$effect(() => {
  const isDone = session.stage === "complete" || session.stage === "failed";
  if (isDone) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    elapsedMs = Date.now() - session.timestamp;
    return;
  }
  elapsedMs = Date.now() - session.timestamp;
  timer = setInterval(() => {
    elapsedMs = Date.now() - session.timestamp;
  }, 100);
  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
});

const elapsed = $derived(formatNumber(elapsedMs, "ms"));
</script>

{#if collapsed}
  <button class="collapsed-row" onclick={onToggle}>
    <span class="collapsed-time">{formatTime(session.timestamp)}</span>
    <span class="collapsed-prov">{session.provider ?? "—"}:{session.model ?? "—"}</span>
    {#if session.response}
      <span
        style="color:{session.response.success ? 'var(--success)' : 'var(--error)'}"
      >
        {session.response.success
          ? String(session.response.statusCode)
          : `${String(session.response.statusCode)} ERR`}
      </span>
      <span>{formatNumber(session.response.ttft, "ms")} TTFT</span>
    {:else}
      <span class="collapsed-pending">pending</span>
    {/if}
  </button>
{:else}
  <div class="session-card" role="button" tabindex="0" onclick={onToggle} onkeydown={(e: KeyboardEvent) => e.key === "Enter" && onToggle?.()}>
    <div class="card-top">
      <div class="stage-dots">
        {#each STAGES as stage, i}
          {#if stage.key === "failed"}
            {@const reached = session.stage === "failed"}
            <span class="dot-wrapper">
              <span
                class="dot {reached ? 'dot-error' : 'dot-empty'}"
              ></span>
              <span class="dot-label">{stage.label}</span>
            </span>
          {:else if stage.key === "complete"}
            {@const reached = session.stage === "complete"}
            <span class="dot-wrapper">
              <span
                class="dot {reached ? 'dot-complete' : 'dot-empty'}"
              ></span>
              <span class="dot-label">{stage.label}</span>
            </span>
          {:else if i <= stageIndex}
            <span class="dot-wrapper">
              <span class="dot dot-filled"></span>
              <span class="dot-label">{stage.label}</span>
            </span>
          {:else}
            <span class="dot-wrapper">
              <span class="dot dot-empty"></span>
              <span class="dot-label">{stage.label}</span>
            </span>
          {/if}
          {#if i < STAGES.length - 1}
            <span
              class="dot-line {i < stageIndex &&
              session.stage !== "failed"
                ? 'line-filled'
                : ''}"
            ></span>
          {/if}
        {/each}
      </div>
      <div class="card-right">
        <div class="provider-badge">
          {session.provider ?? "—"}:{session.model ?? "—"}
        </div>
        <div class="elapsed">{elapsed}</div>
      </div>
    </div>

    {#if session.prompt}
      <div class="prompt-line">{session.prompt}</div>
    {/if}

    {#if session.candidates && session.candidates.length > 0}
      <div class="selection-block">
        <div class="selection-header">
          Strategy: {session.strategy ?? "—"} | Pool: {String(
            session.poolSize ?? 0
          )}
        </div>
        {#each session.candidates as c}
          <div
            class="candidate-row {c.key === session.selected
              ? 'candidate-selected'
              : ''}"
          >
            <span class="cand-prov">{c.provider}</span>
            <span class="cand-model">{c.model}</span>
            {#if c.status === "eligible"}
              <span style="color:{sc(c.score)}">{c.score.toFixed(1)}%</span>
            {:else}
              <span class="badge ineligible">{c.status}</span>
            {/if}
            {#if c.affinity}<span class="badge">affinity</span>{/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if session.failovers.length > 0}
      <div class="failovers">
        {#each session.failovers as f}
          <span class="badge failover"
            >{f.provider}:{f.model} &rarr; {f.errorType}</span
          >
        {/each}
      </div>
    {/if}

    {#if session.outputChars != null || session.thinkingChars != null}
      <div class="token-stats">
        <span>{String(session.outputChars ?? 0)} output chars</span>
        <span class="dot-sep">&middot;</span>
        <span>{String(session.thinkingChars ?? 0)} thinking chars</span>
        {#if session.tokensPerSecond != null}
          <span class="dot-sep">&middot;</span>
          <span>{session.tokensPerSecond} tps</span>
        {/if}
      </div>
    {/if}

    {#if session.response}
      <div class="response-summary">
        <span
          style="color:{session.response.success
            ? 'var(--success)'
            : 'var(--error)'}"
        >
          {session.response.success
            ? String(session.response.statusCode)
            : `${String(session.response.statusCode)} ERR`}
        </span>
        <span>{formatNumber(session.response.ttft, "ms")} TTFT</span>
        <span>{formatNumber(session.response.totalLatency, "ms")} total</span>
        <span>
          {session.response.outputTokens != null
            ? String(session.response.outputTokens)
            : "—"}
          tok
        </span>
        <span>{session.response.finishReason ?? "—"}</span>
        {#if session.response.toolCallFailed}
          <span class="badge tool-err">TOOL-ERR</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .collapsed-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 0.5rem;
    background: none;
    border: none;
    color: var(--muted);
    font-family: monospace;
    font-size: 0.625rem;
    cursor: pointer;
    width: 100%;
    text-align: left;
  }
  .collapsed-row:hover {
    background: rgba(var(--border-rgb), 0.08);
  }
  .collapsed-time {
    color: var(--muted);
    font-size: 0.5625rem;
    min-width: 70px;
  }
  .collapsed-prov {
    color: var(--accent);
    min-width: 180px;
  }
  .collapsed-pending {
    color: var(--warning);
  }

  .session-card {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    cursor: pointer;
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .stage-dots {
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
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .dot-filled {
    background: var(--success);
    transition: background 0.3s ease;
  }
  .dot-complete {
    background: var(--success);
  }
  .dot-error {
    background: var(--error);
  }
  .dot-active {
    background: var(--accent);
    box-shadow: 0 0 4px 1px var(--accent);
  }
  .dot-empty {
    background: transparent;
    border: 1px solid var(--border);
  }
  .dot-label {
    font-size: 0.4375rem;
    color: var(--muted);
    text-transform: uppercase;
    text-align: center;
  }
  .dot-line {
    width: 10px;
    height: 1px;
    background: var(--border);
    margin-bottom: 10px;
  }
  .dot-line.line-filled {
    background: var(--success);
  }

  .card-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }
  .provider-badge {
    color: var(--accent);
    font-family: monospace;
    font-size: 0.625rem;
  }
  .elapsed {
    color: var(--muted);
    font-family: monospace;
    font-size: 0.625rem;
    min-width: 70px;
    text-align: right;
  }

  .prompt-line {
    color: var(--text);
    font-size: 0.6875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .selection-block {
    font-size: 0.625rem;
    padding: 0.25rem 0.5rem;
    background: rgba(var(--border-rgb), 0.08);
    border: 1px solid rgba(var(--border-rgb), 0.2);
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .selection-header {
    color: var(--muted);
    font-size: 0.5625rem;
    text-transform: uppercase;
  }
  .candidate-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.125rem 0;
  }
  .candidate-row.candidate-selected {
    color: var(--success);
  }
  .cand-prov {
    text-transform: capitalize;
    min-width: 70px;
  }
  .cand-model {
    font-family: monospace;
    color: var(--accent);
    font-size: 0.5625rem;
  }

  .failovers {
    font-size: 0.625rem;
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
  .badge {
    display: inline-block;
    font-size: 0.5rem;
    font-weight: 700;
    padding: 0.0625rem 0.25rem;
    text-transform: uppercase;
  }
  .badge.ineligible {
    color: var(--error);
    background: rgba(var(--error-rgb), 0.1);
    border: 1px solid rgba(var(--error-rgb), 0.2);
  }
  .badge.failover {
    color: #e2a93b;
    background: rgba(226, 169, 59, 0.1);
    border: 1px solid rgba(226, 169, 59, 0.2);
  }
  .badge.tool-err {
    color: var(--error);
    background: rgba(var(--error-rgb), 0.1);
  }

  .token-stats {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.625rem;
    color: var(--muted);
    font-family: monospace;
  }
  .dot-sep {
    color: var(--border);
  }

  .response-summary {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.6875rem;
    color: var(--muted);
  }
</style>
