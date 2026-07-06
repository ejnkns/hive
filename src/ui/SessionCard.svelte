<script lang="ts">
import type { SessionStage, SessionState } from "./types";
import { formatNumber, formatTime, sc } from "./utils";

let {
  session,
  fullExpanded = false,
  onToggleFull,
}: {
  session: SessionState;
  fullExpanded?: boolean;
  onToggleFull: () => void;
} = $props();

const STAGE_LABELS: Record<SessionStage, string> = {
  received: "rec",
  selection: "sel",
  dispatched: "dis",
  thinking: "thk",
  streaming: "str",
  tool_use: "too",
  complete: "com",
  failed: "err",
};

const latest = $derived(session.requests.at(-1) ?? null);
const allRequestsNewestFirst = $derived([...session.requests].reverse());

let expandedRequestIds = $state(new Set<string>());

function toggleSubRequest(requestId: string) {
  const next = new Set(expandedRequestIds);
  if (next.has(requestId)) {
    next.delete(requestId);
  } else {
    next.add(requestId);
  }
  expandedRequestIds = next;
}

function isTerminal(stage: SessionStage): boolean {
  return stage === "complete" || stage === "failed";
}

function displayPrompt(prompt: string): string {
  return prompt.length > 50 ? `${prompt.slice(0, 48)}\u2026` : prompt;
}
</script>

<div class="session-card">
  <div class="session-header">
    <span class="header-prov">
      {latest?.provider ?? "—"}:{latest?.model ?? "—"}
    </span>
    {#if latest?.response?.ttft != null}
      <span class="header-latency">
        {formatNumber(latest.response.ttft, "ms")}
      </span>
    {/if}
    <button class="toggle-btn" onclick={onToggleFull}>
      {fullExpanded ? "collapse" : "expand"}
    </button>
  </div>

  {#if latest}
    <div class="latest-section">
      {#if latest.path.length > 0}
        <div class="path-dots">
          {#each latest.path as stage, si}
            <span class="dot-wrapper">
              <span
                class="dot"
                class:dot-error={stage === "failed"}
                class:dot-complete={stage === "complete"}
                class:dot-active={si ===
                  latest.path.length - 1 &&
                  !isTerminal(stage)}
                class:dot-filled={si <
                  latest.path.length - 1 ||
                  isTerminal(stage)}
              ></span>
              <span class="dot-label">{STAGE_LABELS[stage]}</span>
            </span>
            {#if si < latest.path.length - 1}
              <span class="dot-line dot-line-filled"></span>
            {/if}
          {/each}
        </div>
      {/if}

      <div class="prompt-line">{latest.prompt ?? ""}</div>

      {#if latest.candidates && latest.candidates.length > 0}
        <div class="selection-block">
          <div class="selection-header">
            selection: {latest.strategy ?? "—"} &middot;
            {String(latest.poolSize ?? 0)} candidates &middot;
            {latest.selected ?? "none"}
          </div>
          {#each latest.candidates as c}
            <div
              class="candidate-row"
              class:candidate-selected={c.key === latest.selected}
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

      {#if latest.failovers.length > 0}
        <div class="failovers">
          {#each latest.failovers as f}
            <span class="badge failover"
              >{f.provider}:{f.model} &rarr; {f.errorType}</span
            >
          {/each}
        </div>
      {/if}

      {#if (latest.outputChars != null || latest.thinkingChars != null)}
        <div class="token-stats">
          <span>{String(latest.outputChars ?? 0)} output chars</span>
          <span class="dot-sep">&middot;</span>
          <span>{String(latest.thinkingChars ?? 0)} thinking chars</span>
          {#if latest.tokensPerSecond != null}
            <span class="dot-sep">&middot;</span>
            <span>{latest.tokensPerSecond} tps</span>
          {/if}
        </div>
      {/if}

      {#if latest.response}
        <div class="response-summary">
          <span
            style="color:{latest.response.success
              ? 'var(--success)'
              : 'var(--error)'}"
          >
            {latest.response.success
              ? String(latest.response.statusCode)
              : `${String(latest.response.statusCode)} ERR`}
          </span>
          <span
            >{formatNumber(latest.response.ttft, "ms")} TTFT</span
          >
          <span
            >{formatNumber(latest.response.totalLatency, "ms")} total</span
          >
          <span>
            {latest.response.outputTokens != null
              ? String(latest.response.outputTokens)
              : "—"}
            tok
          </span>
          <span>{latest.response.finishReason ?? "—"}</span>
          {#if latest.response.toolCallFailed}
            <span class="badge tool-err">TOOL-ERR</span>
          {/if}
          {#if latest.toolLoopDetected}
            <span class="badge tool-loop">LOOP</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#each allRequestsNewestFirst as req, i}
    {#if fullExpanded || i > 0}
      {@const isFirstVisible = fullExpanded ? i === 0 : i === 1}
      {@const isFullyVisible = fullExpanded || isFirstVisible}
      {@const isSubExpanded = expandedRequestIds.has(req.requestId)}
      {@const lastStage = req.path[req.path.length - 1]}
      {@const completed = lastStage !== undefined && isTerminal(lastStage)}
      {@const label = fullExpanded && i === 0
        ? "latest"
        : completed
          ? `#${i + 1}`
          : `#${i + 1} (active)`}

    {#if isFullyVisible || isSubExpanded}
      <div
        class="request-subcard {fullExpanded && i === 0
          ? ''
          : 'request-prev'}"
        class:request-latest={fullExpanded && i === 0}
      >
        <div class="req-header">
          <span class="req-label">{label}</span>
          <span class="req-time">{formatTime(req.timestamp)}</span>
          <span class="req-prov"
            >{req.provider ?? "—"}:{req.model ?? "—"}</span
          >
          {#if completed && req.response}
            <span
              style="color:{req.response.success
                ? 'var(--success)'
                : 'var(--error)'}; font-size: 0.5625rem;"
            >
              {req.response.success
                ? String(req.response.statusCode)
                : `${String(req.response.statusCode)} ERR`}
            </span>
            <span class="req-latency">
              {formatNumber(req.response.ttft, "ms")}
            </span>
          {:else if !completed}
            <span class="req-pending">active</span>
          {/if}
          {#if !isFullyVisible}
            <button
              class="sub-close-btn"
              onclick={() => toggleSubRequest(req.requestId)}
              >&times;</button
            >
          {/if}
        </div>

        {#if req.path.length > 0}
          <div class="path-dots">
            {#each req.path as stage, si}
              <span class="dot-wrapper">
                <span
                  class="dot"
                  class:dot-error={stage === "failed"}
                  class:dot-complete={stage === "complete"}
                  class:dot-active={si ===
                    req.path.length - 1 &&
                    !isTerminal(stage)}
                  class:dot-filled={si <
                    req.path.length - 1 ||
                    isTerminal(stage)}
                ></span>
                <span class="dot-label">{STAGE_LABELS[stage]}</span>
              </span>
              {#if si < req.path.length - 1}
                <span class="dot-line dot-line-filled"></span>
              {/if}
            {/each}
          </div>
        {/if}

        <div class="prompt-line">{req.prompt ?? ""}</div>

        {#if req.candidates && req.candidates.length > 0}
          <div class="selection-block">
            <div class="selection-header">
              selection: {req.strategy ?? "—"} &middot;
              {String(req.poolSize ?? 0)} candidates &middot;
              {req.selected ?? "none"}
            </div>
            {#each req.candidates as c}
              <div
                class="candidate-row"
                class:candidate-selected={c.key === req.selected}
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

        {#if req.failovers.length > 0}
          <div class="failovers">
            {#each req.failovers as f}
              <span class="badge failover"
                >{f.provider}:{f.model} &rarr; {f.errorType}</span
              >
            {/each}
          </div>
        {/if}

        {#if (req.outputChars != null || req.thinkingChars != null)}
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
              >{formatNumber(req.response.totalLatency, "ms")} total</span
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
            {#if req.toolLoopDetected}
              <span class="badge tool-loop">LOOP</span>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <div class="compact-row">
        <span class="compact-label"
          >{completed ? `#${i + 1}` : `#${i + 1} (active)`}</span
        >
        {#if req.path.length > 0}
          <span class="mini-dots">
            {#each req.path as stage, si}
              <span
                class="mini-dot {isTerminal(stage)
                  ? 'mini-dot-complete'
                  : ''} {stage === 'failed' ? 'mini-dot-error' : ''}"
              ></span>
              {#if si < req.path.length - 1}
                <span class="mini-line"></span>
              {/if}
            {/each}
          </span>
        {/if}
        <span class="compact-prov"
          >{req.provider ?? "—"}:{req.model ?? "—"}</span
        >
        {#if completed && req.response}
          <span
            style="color:{req.response.success
              ? 'var(--success)'
              : 'var(--error)'}"
          >
            {req.response.success
              ? String(req.response.statusCode)
              : `${String(req.response.statusCode)} ERR`}
          </span>
          <span>{formatNumber(req.response.ttft, "ms")}</span>
        {:else if !completed}
          <span class="compact-pending">active</span>
        {/if}
        <span class="compact-prompt">{displayPrompt(
          req.prompt ?? ""
        )}</span>
        <button
          class="sub-expand-btn"
          onclick={() => toggleSubRequest(req.requestId)}
          >&#x25B8;</button
        >
      </div>
    {/if}
    {/if}
  {/each}
</div>

<style>
  .session-card {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .session-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .header-prov {
    color: var(--accent);
    font-family: monospace;
    font-size: 0.75rem;
    font-weight: 700;
    margin-right: auto;
  }
  .header-latency {
    color: var(--muted);
    font-family: monospace;
    font-size: 0.6875rem;
  }
  .toggle-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--muted);
    font-family: monospace;
    font-size: 0.5625rem;
    cursor: pointer;
    padding: 0.0625rem 0.375rem;
    text-transform: uppercase;
  }
  .toggle-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .latest-section {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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
  .badge.tool-loop {
    color: #e2a93b;
    background: rgba(226, 169, 59, 0.1);
    border: 1px solid rgba(226, 169, 59, 0.2);
  }

  .token-stats {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.625rem;
    color: var(--muted);
    font-family: monospace;
  }

  .response-summary {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.6875rem;
    color: var(--muted);
  }
  .dot-sep {
    color: var(--border);
  }

  .request-subcard {
    border-top: 1px solid rgba(var(--border-rgb), 0.3);
    padding-top: 0.375rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .request-prev {
    margin-left: 1rem;
    border-left: 2px solid var(--border);
    padding-left: 0.5rem;
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
  .req-pending {
    color: var(--warning);
    font-size: 0.5rem;
  }
  .sub-close-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 0.6875rem;
    padding: 0;
    line-height: 1;
  }
  .sub-close-btn:hover {
    color: var(--error);
  }

  .compact-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.125rem 0;
    font-family: monospace;
    font-size: 0.5625rem;
  }
  .compact-label {
    color: var(--accent);
    font-weight: 700;
    min-width: 42px;
  }
  .mini-dots {
    display: flex;
    align-items: center;
    gap: 0;
    min-width: 30px;
  }
  .mini-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--success);
    flex-shrink: 0;
  }
  .mini-dot-complete {
    background: var(--success);
  }
  .mini-dot-error {
    background: var(--error);
  }
  .mini-line {
    width: 4px;
    height: 1px;
    background: var(--success);
    flex-shrink: 0;
  }
  .compact-prov {
    color: var(--accent);
    font-size: 0.5rem;
  }
  .compact-pending {
    color: var(--warning);
  }
  .compact-prompt {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 240px;
  }
  .sub-expand-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 0.625rem;
    padding: 0;
    line-height: 1;
    margin-left: auto;
  }
  .sub-expand-btn:hover {
    color: var(--accent);
  }
</style>
