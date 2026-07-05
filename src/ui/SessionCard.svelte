<script lang="ts">
import type { RequestState, SessionState } from "./types";
import { formatNumber, formatTime, sc } from "./utils";

let {
  session,
  collapsed = false,
  onToggle,
}: {
  session: SessionState;
  collapsed?: boolean;
  onToggle: () => void;
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

const currentRequest = $derived(session.requests.at(-1) ?? null);
const requestCount = $derived(session.requests.length);
const completedRequests = $derived(
  session.requests.filter((r) => r.stage === "complete" || r.stage === "failed")
);
const avgTtft = $derived.by(() => {
  const finished = completedRequests.filter((r) => r.response != null);
  if (finished.length === 0) return null;
  return Math.round(
    finished.reduce((sum, r) => sum + (r.response?.ttft ?? 0), 0) /
      finished.length
  );
});
const lastResponse = $derived(currentRequest?.response ?? null);

const stageIndex = $derived(
  currentRequest ? STAGES.findIndex((s) => s.key === currentRequest.stage) : -1
);

let elapsedMs = $state(0);
let timer: ReturnType<typeof setInterval> | null = null;

$effect(() => {
  if (!currentRequest) return;
  const isDone =
    currentRequest.stage === "complete" || currentRequest.stage === "failed";
  if (isDone) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    elapsedMs = Date.now() - currentRequest.timestamp;
    return;
  }
  elapsedMs = Date.now() - currentRequest.timestamp;
  timer = setInterval(() => {
    elapsedMs = Date.now() - currentRequest.timestamp;
  }, 100);
  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
});

const elapsed = $derived(formatNumber(elapsedMs, "ms"));

let showHistory = $state(false);
</script>

{#if collapsed}
  <button class="collapsed-row" onclick={onToggle}>
    <span class="collapsed-time">{formatTime(
      currentRequest?.timestamp ?? 0
    )}</span>
    <span class="collapsed-prov">{currentRequest?.provider ??
      "—"}:{currentRequest?.model ?? "—"}</span>
    <span class="collapsed-count">{requestCount} req{requestCount !==
      1
      ? "s"
      : ""}</span>
    {#if lastResponse}
      <span
        style="color:{lastResponse.success
          ? 'var(--success)'
          : 'var(--error)'}"
      >
        {lastResponse.success
          ? String(lastResponse.statusCode)
          : `${String(lastResponse.statusCode)} ERR`}
      </span>
      <span>{formatNumber(lastResponse.ttft, "ms")}</span>
    {:else}
      <span class="collapsed-pending">active</span>
    {/if}
    {#if avgTtft != null}
      <span class="collapsed-avg">avg: {formatNumber(
        avgTtft,
        "ms"
      )}</span>
    {/if}
  </button>
{:else}
  <div class="session-card">
    <button class="collapse-btn" onclick={onToggle}>&minus;</button>

    <div class="summary-bar">
      <span class="summary-count">{requestCount} request{requestCount !==
        1
        ? "s"
        : ""}</span>
      {#if lastResponse}
        <span
          style="color:{lastResponse.success
            ? 'var(--success)'
            : 'var(--error)'}"
        >
          &middot; last: {lastResponse.success
            ? String(lastResponse.statusCode)
            : `${String(lastResponse.statusCode)} ERR`}
        </span>
        <span class="dot-sep">&middot;</span>
        <span>{formatNumber(lastResponse.ttft, "ms")}</span>
      {/if}
      {#if avgTtft != null}
        <span class="dot-sep">&middot;</span>
        <span>avg: {formatNumber(avgTtft, "ms")}</span>
      {/if}
      <span class="summary-right">
        {#if currentRequest}
          <span class="provider-badge"
            >{currentRequest.provider ?? "—"}:{currentRequest.model ??
              "—"}</span
          >
          <span class="dot-sep">&middot;</span>
        {/if}
        <span class="elapsed">{elapsed}</span>
      </span>
    </div>

    {#if currentRequest}
      <div class="stage-dots">
        {#each STAGES as stage, i}
          {#if stage.key === "failed"}
            {@const reached = currentRequest.stage === "failed"}
            <span class="dot-wrapper">
              <span
                class="dot {reached ? 'dot-error' : 'dot-empty'}"
              ></span>
              <span class="dot-label">{stage.label}</span>
            </span>
          {:else if stage.key === "complete"}
            {@const reached = currentRequest.stage === "complete"}
            <span class="dot-wrapper">
              <span
                class="dot {reached
                  ? 'dot-complete'
                  : 'dot-empty'}"
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
              currentRequest.stage !== "failed"
                ? 'line-filled'
                : ''}"
            ></span>
          {/if}
        {/each}
      </div>

      {#if currentRequest.prompt}
        <div class="prompt-line">{currentRequest.prompt}</div>
      {/if}

      {#if currentRequest.candidates &&
        currentRequest.candidates.length > 0}
        <div class="selection-block">
          <div class="selection-header">
            Strategy: {currentRequest.strategy ?? "—"} | Pool: {String(
              currentRequest.poolSize ?? 0
            )}
          </div>
          {#each currentRequest.candidates as c}
            <div
              class="candidate-row {c.key === currentRequest.selected
                ? 'candidate-selected'
                : ''}"
            >
              <span class="cand-prov">{c.provider}</span>
              <span class="cand-model">{c.model}</span>
              {#if c.status === "eligible"}
                <span style="color:{sc(c.score)}"
                  >{c.score.toFixed(1)}%</span
                >
              {:else}
                <span class="badge ineligible">{c.status}</span>
              {/if}
              {#if c.affinity}<span class="badge">affinity</span>{/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if currentRequest.failovers.length > 0}
        <div class="failovers">
          {#each currentRequest.failovers as f}
            <span class="badge failover"
              >{f.provider}:{f.model} &rarr; {f.errorType}</span
            >
          {/each}
        </div>
      {/if}

      {#if currentRequest.outputChars != null ||
        currentRequest.thinkingChars != null}
        <div class="token-stats">
          <span>{String(currentRequest.outputChars ??
            0)} output chars</span>
          <span class="dot-sep">&middot;</span>
          <span>{String(currentRequest.thinkingChars ??
            0)} thinking chars</span>
          {#if currentRequest.tokensPerSecond != null}
            <span class="dot-sep">&middot;</span>
            <span>{currentRequest.tokensPerSecond} tps</span>
          {/if}
        </div>
      {/if}

      {#if currentRequest.response}
        <div class="response-summary">
          <span
            style="color:{currentRequest.response.success
              ? 'var(--success)'
              : 'var(--error)'}"
          >
            {currentRequest.response.success
              ? String(currentRequest.response.statusCode)
              : `${String(currentRequest.response.statusCode)} ERR`}
          </span>
          <span
            >{formatNumber(
              currentRequest.response.ttft,
              "ms"
            )} TTFT</span
          >
          <span
            >{formatNumber(
              currentRequest.response.totalLatency,
              "ms"
            )} total</span
          >
          <span>
            {currentRequest.response.outputTokens != null
              ? String(currentRequest.response.outputTokens)
              : "—"}
            tok
          </span>
          <span>{currentRequest.response.finishReason ?? "—"}</span>
          {#if currentRequest.response.toolCallFailed}
            <span class="badge tool-err">TOOL-ERR</span>
          {/if}
        </div>
      {/if}
    {/if}

    {#if completedRequests.length > 0}
      <button class="history-toggle" onclick={() =>
        (showHistory = !showHistory)}>
        <span class="history-arrow">{showHistory
            ? "\u25BE"
            : "\u25B8"}</span>
        History ({completedRequests.length} completed)
      </button>
      {#if showHistory}
        {#each completedRequests as req}
          <div class="history-row">
            <span class="history-time">{formatTime(
              req.timestamp
            )}</span>
            <span
              style="color:{req.response?.success
                ? 'var(--success)'
                : req.response
                  ? 'var(--error)'
                  : 'var(--muted)'}"
            >
              {req.response?.success
                ? String(req.response.statusCode)
                : req.response
                  ? `${String(req.response.statusCode)} ERR`
                  : "..."}
            </span>
            <span>{req.response
                ? formatNumber(req.response.ttft, "ms")
                : "..."}</span>
            <span class="history-prov">{req.provider}:{req.model}</span>
          </div>
        {/each}
      {/if}
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
  .collapsed-count {
    color: var(--muted);
    min-width: 40px;
  }
  .collapsed-pending {
    color: var(--warning);
  }
  .collapsed-avg {
    color: var(--muted);
  }

  .session-card {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    position: relative;
  }

  .collapse-btn {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    background: none;
    border: none;
    color: var(--muted);
    font-family: monospace;
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
  }
  .collapse-btn:hover {
    color: var(--text);
  }

  .summary-bar {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.625rem;
    color: var(--muted);
    padding-right: 1.25rem;
  }
  .summary-count {
    font-weight: 700;
    color: var(--accent);
  }
  .summary-right {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-left: auto;
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
  .candidate-selected {
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

  .history-toggle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.25rem;
    background: none;
    border: 1px solid var(--border);
    color: var(--muted);
    font-family: monospace;
    font-size: 0.5625rem;
    cursor: pointer;
    text-align: left;
  }
  .history-toggle:hover {
    background: rgba(var(--border-rgb), 0.08);
  }
  .history-arrow {
    font-size: 0.5625rem;
  }
  .history-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: monospace;
    font-size: 0.5625rem;
    color: var(--muted);
    padding: 0.125rem 0.25rem;
  }
  .history-time {
    min-width: 70px;
  }
  .history-prov {
    color: var(--accent);
    font-size: 0.5rem;
  }
</style>
