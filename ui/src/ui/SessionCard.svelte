<script lang="ts">
import type { RequestState, SessionStage, SessionState } from "./types";
import { formatNumber } from "./utils";
import RequestDetailModal from "./session-card/request-detail-modal.svelte";
import SessionSummaryModal from "./session-card/session-summary-modal.svelte";

let {
  session,
}: {
  session: SessionState;
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
const requestCount = $derived(session.requests.length);

let listOpen = $state(false);
let summaryModalOpen = $state(false);
let detailModalTarget = $state<RequestState | null>(null);
let detailModalOpen = $state(false);

$effect(() => {
  if (!detailModalOpen) detailModalTarget = null;
});

function isTerminal(stage: SessionStage): boolean {
  return stage === "complete" || stage === "failed";
}

function requestLabel(i: number): string {
  const req = allRequestsNewestFirst[i];
  const last = req.path.at(-1);
  const completed = last !== undefined && isTerminal(last);
  const num = requestCount - i;
  const isFailover = req.requestId.includes("/F");
  if (isFailover) return completed ? `#${num}F` : `#${num}R`;
  return `#${num}`;
}

function displayPrompt(prompt: string): string {
  return prompt.length > 50 ? `${prompt.slice(0, 48)}\u2026` : prompt;
}

function openDetailModal(req: RequestState) {
  detailModalTarget = req;
  detailModalOpen = true;
}

function handleSummaryOpenDetail(req: RequestState) {
  summaryModalOpen = false;
  detailModalTarget = req;
  detailModalOpen = true;
}

function handleSelectRequest(requestId: string) {
  const req = session.requests.find((r) => r.requestId === requestId);
  if (req) detailModalTarget = req;
}
</script>

<div class="session-card">
  <button class="summary-card" onclick={() => (summaryModalOpen = true)}>
    <div class="summary-header">
      <span class="summary-prov">
        {latest?.provider ?? "—"}:{latest?.model ?? "—"}
      </span>
      {#if latest?.response}
        <span
          class="summary-status"
          style="color:{latest.response.success
            ? 'var(--success)'
            : 'var(--error)'}"
        >
          {latest.response.success
            ? String(latest.response.statusCode)
            : `${String(latest.response.statusCode)} ERR`}
        </span>
        <span class="summary-latency">
          {formatNumber(latest.response.ttft, "ms")}
        </span>
      {/if}
    </div>

    {#if latest}
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

      <div class="summary-prompt">{latest.prompt ?? ""}</div>
    {/if}
  </button>

  {#if requestCount > 1}
    <button class="list-toggle" onclick={() => (listOpen = !listOpen)}>
      <span class="list-arrow">{listOpen ? "\u25BE" : "\u25B8"}</span>
      {requestCount} request{requestCount !== 1 ? "s" : ""}
    </button>
  {/if}

  {#if listOpen}
    <div class="request-list">
      {#each allRequestsNewestFirst as req, i}
        <button
          class="request-row"
          onclick={() => openDetailModal(req)}
        >
          <span class="row-label">{requestLabel(i)}</span>
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
          <span class="row-prov"
            >{req.provider ?? "—"}:{req.model ?? "—"}</span
          >
          {#if req.response}
            <span
              style="color:{req.response.success
                ? 'var(--success)'
                : 'var(--error)'}"
            >
              {req.response.success
                ? String(req.response.statusCode)
                : `${String(req.response.statusCode)} ERR`}
            </span>
            <span class="row-latency">
              {formatNumber(req.response.ttft, "ms")}
            </span>
          {/if}
          <span class="row-prompt">{displayPrompt(req.prompt ?? "")}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<SessionSummaryModal
  bind:open={summaryModalOpen}
  {session}
  onOpenDetail={handleSummaryOpenDetail}
/>

{#if detailModalTarget}
  <RequestDetailModal
    bind:open={detailModalOpen}
    requests={session.requests}
    activeRequestId={detailModalTarget.requestId}
    onSelectRequest={handleSelectRequest}
  />
{/if}

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

  .summary-card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    color: var(--text);
    width: 100%;
  }

  .summary-card:hover {
    opacity: 0.85;
  }

  .summary-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .summary-prov {
    color: var(--accent);
    font-family: monospace;
    font-size: 0.75rem;
    font-weight: 700;
    margin-right: auto;
  }

  .summary-status {
    font-family: monospace;
    font-size: 0.6875rem;
    font-weight: 700;
  }

  .summary-latency {
    color: var(--muted);
    font-family: monospace;
    font-size: 0.6875rem;
  }

  .summary-prompt {
    color: var(--text);
    font-size: 0.6875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

  .list-toggle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    background: none;
    border: none;
    color: var(--muted);
    font-family: monospace;
    font-size: 0.5625rem;
    cursor: pointer;
    padding: 0;
    width: 100%;
    text-align: left;
  }

  .list-toggle:hover {
    color: var(--accent);
  }

  .list-arrow {
    font-size: 0.625rem;
  }

  .request-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin-left: 0.25rem;
    padding-left: 0.5rem;
    border-left: 2px solid var(--border);
  }

  .request-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.125rem 0;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: monospace;
    font-size: 0.5625rem;
    color: var(--text);
    width: 100%;
  }

  .request-row:hover {
    background: rgba(var(--border-rgb), 0.08);
  }

  .row-label {
    color: var(--accent);
    font-weight: 700;
    width: 28px;
    flex-shrink: 0;
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

  .row-prov {
    color: var(--accent);
    font-size: 0.5rem;
  }

  .row-latency {
    color: var(--muted);
  }

  .row-prompt {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
</style>
