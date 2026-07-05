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

const requestCount = $derived(session.requests.length);
const latest = $derived(session.requests.at(-1) ?? null);
const completedRequests = $derived(
  session.requests.filter((r) => {
    const last = r.path[r.path.length - 1];
    return last === "complete" || last === "failed";
  })
);
const avgTtft = $derived.by(() => {
  const finished = completedRequests.filter((r) => r.response != null);
  if (finished.length === 0) return null;
  return Math.round(
    finished.reduce((sum, r) => sum + (r.response?.ttft ?? 0), 0) /
      finished.length
  );
});
const lastResponse = $derived(latest?.response ?? null);
const allRequestsNewestFirst = $derived([...session.requests].reverse());

const lastPathStageIdx = (req: RequestState) => {
  const last = req.path[req.path.length - 1];
  if (!last) return -1;
  return STAGES.findIndex((s) => s.key === last);
};
</script>

{#if collapsed}
  <button class="collapsed-row" onclick={onToggle}>
    <span class="collapsed-time">{formatTime(
      latest?.timestamp ?? 0
    )}</span>
    <span class="collapsed-prov">{latest?.provider ?? "—"}:{latest
      ?.model ?? "—"}</span>
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
        {#if latest}
          <span class="provider-badge"
            >{latest.provider ?? "—"}:{latest.model ?? "—"}</span
          >
        {/if}
      </span>
    </div>

    {#each allRequestsNewestFirst as req, i}
      {@const isLatest = i === 0}
      {@const idx = lastPathStageIdx(req)}
      {@const lastStage = req.path[req.path.length - 1]}
      <div class="request-subcard" class:request-latest={isLatest}>
        <div class="req-header">
          <span class="req-label">{isLatest
              ? "latest"
              : `#${allRequestsNewestFirst.length - i}`}</span>
          <span class="req-time">{formatTime(req.timestamp)}</span>
          <span class="req-prov"
            >{req.provider ?? "—"}:{req.model ?? "—"}</span>
          {#if req.response}
            <span
              style="color:{req.response.success
                ? 'var(--success)'
                : 'var(--error)'}; font-size: 0.5625rem;"
            >
              {req.response.success
                ? String(req.response.statusCode)
                : `${String(req.response.statusCode)} ERR`}
            </span>
          {/if}
          <span class="req-latency">
            {formatNumber(req.response?.ttft ?? null, "ms")}
          </span>
        </div>
        <div class="stage-dots">
          {#each STAGES as stage, si}
            {#if stage.key === "failed"}
              {@const reached = lastStage === "failed"}
              <span class="dot-wrapper">
                <span
                  class="dot {reached ? 'dot-error' : 'dot-empty'}"
                ></span>
                <span class="dot-label">{stage.label}</span>
              </span>
            {:else if stage.key === "complete"}
              {@const reached = lastStage === "complete"}
              <span class="dot-wrapper">
                <span
                  class="dot {reached
                    ? 'dot-complete'
                    : 'dot-empty'}"
                ></span>
                <span class="dot-label">{stage.label}</span>
              </span>
            {:else if si <= idx}
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
            {#if si < STAGES.length - 1}
              <span
                class="dot-line {si < idx &&
                lastStage !== "failed"
                  ? 'line-filled'
                  : ''}"
              ></span>
            {/if}
          {/each}
        </div>
        {#if req.prompt}
          <div class="prompt-line">{req.prompt}</div>
        {/if}
        {#if req.failovers.length > 0}
          <div class="failovers">
            {#each req.failovers as f}
              <span class="badge failover"
                >{f.provider}:{f.model} &rarr; {f.errorType}</span
              >
            {/each}
          </div>
        {/if}
        {#if isLatest && req.candidates && req.candidates.length > 0}
          <div class="selection-block">
            <div class="selection-header">
              Strategy: {req.strategy ?? "—"} | Pool: {String(
                req.poolSize ?? 0
              )}
            </div>
            {#each req.candidates as c}
              <div
                class="candidate-row {c.key === req.selected
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
                {#if c.affinity}<span class="badge">affinity</span
                >{/if}
              </div>
            {/each}
          </div>
        {/if}
        {#if isLatest &&
          (req.outputChars != null || req.thinkingChars != null)}
          <div class="token-stats">
            <span>{String(req.outputChars ?? 0)} output chars</span>
            <span class="dot-sep">&middot;</span>
            <span>{String(req.thinkingChars ?? 0)} thinking chars</span>
            {#if req.tokensPerSecond != null}
              <span class="dot-sep">&middot;</span>
              <span>{req.tokensPerSecond} tps</span>
            {/if}
          </div>
        {/if}
        {#if req.response}
          <div class="response-summary">
            <span
              style="color:{req.response.success
                ? 'var(--success)'
                : 'var(--error)'}"
            >
              {req.response.success
                ? String(req.response.statusCode)
                : `${String(req.response.statusCode)} ERR`}
            </span>
            <span
              >{formatNumber(req.response.ttft, "ms")} TTFT</span
            >
            <span
              >{formatNumber(
                req.response.totalLatency,
                "ms"
              )} total</span
            >
            <span>
              {req.response.outputTokens != null
                ? String(req.response.outputTokens)
                : "—"}
              tok
            </span>
            <span>{req.response.finishReason ?? "—"}</span>
            {#if req.response.toolCallFailed}
              <span class="badge tool-err">TOOL-ERR</span>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
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
    gap: 0.5rem;
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

  .request-subcard {
    border-top: 1px solid rgba(var(--border-rgb), 0.3);
    padding-top: 0.375rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .req-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: monospace;
    font-size: 0.5625rem;
  }
  .req-label {
    color: var(--accent);
    font-weight: 700;
    text-transform: uppercase;
    min-width: 42px;
  }
  .req-time {
    color: var(--muted);
  }
  .req-prov {
    color: var(--accent);
    font-size: 0.5rem;
  }
  .req-latency {
    color: var(--muted);
    margin-left: auto;
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
</style>
