<script lang="ts">
import type { RequestState } from "shared/dashboard-types";
import { formatNumber, formatTime, sc } from "../../shared/utils";
import { isTerminal } from "../stage-utils";
import StagePathDots from "../StagePathDots.svelte";
import ConversationView from "../ConversationView.svelte";
import Modal from "../../shared/Modal.svelte";

let {
  open = $bindable(false),
  requests = [] as RequestState[],
  activeRequestId = "",
  onSelectRequest,
}: {
  open?: boolean;
  requests: RequestState[];
  activeRequestId: string;
  onSelectRequest?: (requestId: string) => void;
} = $props();

const request = $derived(
  requests.find((r) => r.requestId === activeRequestId) ?? null
);
const activeIndex = $derived(
  requests.findIndex((r) => r.requestId === activeRequestId)
);

const label = $derived.by(() => {
  if (!request) return "";
  const last = request.path.at(-1);
  const completed = last !== undefined && isTerminal(last);
  return completed ? `#${activeIndex + 1}` : `#${activeIndex + 1} (active)`;
});

const hasConversation = $derived(
  request &&
    ((request.conversationPrompt && request.conversationPrompt.length > 0) ||
      !!request.responseText)
);
</script>

<Modal bind:open title="Request {label}">
  <div class="modal-body">
    {#if requests.length > 1}
      <div class="tabs">
        {#each requests as req, i}
          <button
            class="tab {req.requestId === activeRequestId ? 'tab-active' : ''}"
            onclick={() => onSelectRequest?.(req.requestId)}
            type="button"
          >
            {#if req.requestId === activeRequestId}
              <span class="tab-current"></span>
            {/if}
            {isTerminal(req.path.at(-1) ?? "complete") ? `#${i + 1}` : `#${i + 1} (active)`}
          </button>
        {/each}
      </div>
    {/if}

    {#if request}
      <div class="detail-section">
        <div class="section-title">metadata</div>
        <div class="detail-grid">
          <div class="field">
            <span class="field-label">Request ID</span>
            <span class="field-val mono">{request.requestId}</span>
          </div>
          <div class="field">
            <span class="field-label">Provider</span>
            <span class="field-val">{request.provider ?? "—"}</span>
          </div>
          <div class="field">
            <span class="field-label">Model</span>
            <span class="field-val mono">{request.model ?? "—"}</span>
          </div>
          <div class="field">
            <span class="field-label">Time</span>
            <span class="field-val">{formatTime(request.timestamp)}</span>
          </div>
        </div>
      </div>

      {#if request.path.length > 0}
        <StagePathDots path={request.path} showSectionTitle={true} />
      {/if}

      {#if request.prompt}
        <div class="detail-section">
          <div class="section-title">prompt</div>
          <div class="prompt-text">{request.prompt}</div>
        </div>
      {/if}

      {#if request.candidates && request.candidates.length > 0}
        <div class="detail-section">
          <div class="section-title">selection</div>
          <div class="selection-header">
            {request.strategy ?? "—"} &middot;
            {String(request.poolSize ?? 0)} candidates &middot;
            {request.selected ?? "none"}
          </div>
          {#each request.candidates as c}
            <div
              class="candidate-row"
              class:candidate-selected={c.key === request.selected}
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

      {#if request.failovers.length > 0}
        <div class="detail-section">
          <div class="section-title">failovers</div>
          <div class="failovers">
            {#each request.failovers as f}
              <span class="badge failover"
                >{f.provider}:{f.model} &rarr; {f.errorType}</span
              >
            {/each}
          </div>
        </div>
      {/if}

      {#if request.overrideError}
        <div class="detail-section">
          <div class="section-title">pinned node error</div>
          <div class="override-detail">
            <span class="od-prov">{request.overrideError.provider}:{request.overrideError.model}</span>
            <span class="od-status">status {request.overrideError.statusCode}</span>
            <span class="od-type">{request.overrideError.errorType}</span>
            <div class="od-body">{request.overrideError.errorBody}</div>
          </div>
        </div>
      {/if}

      {#if request.response}
        <div class="detail-section">
          <div class="section-title">response</div>
          <div class="detail-grid">
            <div class="field">
              <span class="field-label">Status</span>
              <span
                class="field-val"
                style="color:{request.response.success
                  ? 'var(--success)'
                  : 'var(--error)'}"
              >
                {request.response.success
                  ? String(request.response.statusCode)
                  : `${String(request.response.statusCode)} ERR`}
              </span>
            </div>
            <div class="field">
              <span class="field-label">TTFT</span>
              <span class="field-val"
                >{formatNumber(request.response.ttft, "ms")}</span
              >
            </div>
            <div class="field">
              <span class="field-label">Total</span>
              <span class="field-val"
                >{formatNumber(request.response.totalLatency, "ms")}</span
              >
            </div>
            <div class="field">
              <span class="field-label">Tokens</span>
              <span class="field-val"
                >{request.response.outputTokens != null
                  ? String(request.response.outputTokens)
                  : "—"}</span
              >
            </div>
            <div class="field">
              <span class="field-label">Finish</span>
              <span class="field-val"
                >{request.response.finishReason ?? "—"}</span
              >
            </div>
            {#if request.response.toolCallFailed}
              <div class="field">
                <span class="field-label">Tool Err</span>
                <span class="field-val" style="color: var(--error)"
                  >Yes</span
                >
              </div>
            {/if}
            {#if request.toolLoopDetected}
              <div class="field">
                <span class="field-label">Loop</span>
                <span class="field-val" style="color: var(--warning)"
                  >Detected</span
                >
              </div>
            {/if}
          </div>
        </div>
      {/if}

      {#if (request.outputChars != null || request.thinkingChars != null)}
        <div class="detail-section">
          <div class="section-title">tokens</div>
          <div class="token-stats">
            <span>{String(request.outputChars ?? 0)} output chars</span>
            <span class="dot-sep">&middot;</span>
            <span>{String(request.thinkingChars ?? 0)} thinking chars</span>
            {#if request.tokensPerSecond != null}
              <span class="dot-sep">&middot;</span>
              <span>{request.tokensPerSecond} tps</span>
            {/if}
          </div>
        </div>
      {/if}

      {#if hasConversation}
        <div class="detail-section">
          <div class="section-title">conversation</div>
          <ConversationView
            messages={request?.conversationPrompt ?? []}
            responseText={request?.responseText}
          />
        </div>
      {/if}
    {/if}
  </div>
</Modal>

<style>
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .tabs {
    display: flex;
    gap: 0.125rem;
    flex-wrap: wrap;
    padding-bottom: 0.375rem;
    border-bottom: 1px solid var(--border);
  }

  .tab {
    background: none;
    border: 1px solid var(--border);
    color: var(--muted);
    font-family: monospace;
    font-size: 0.5625rem;
    cursor: pointer;
    padding: 0.0625rem 0.375rem;
    text-transform: uppercase;
  }

  .tab:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .tab-active {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 700;
  }

  .detail-section {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .section-title {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--muted);
  }

  .detail-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.125rem 0.75rem;
    font-size: 0.6875rem;
  }

  .field {
    display: contents;
  }

  .field-label {
    color: var(--muted);
  }

  .field-val {
    color: var(--text);
  }

  .field-val.mono {
    font-family: monospace;
    font-size: 0.5625rem;
  }

  .prompt-text {
    color: var(--text);
    font-size: 0.6875rem;
    white-space: pre-wrap;
    word-break: break-word;
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
    font-size: 0.625rem;
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

  .failovers {
    font-size: 0.625rem;
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .override-detail {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .od-prov {
    font-family: monospace;
    font-size: 0.625rem;
    color: var(--accent);
  }

  .od-status {
    font-size: 0.5625rem;
    color: var(--error);
    font-weight: 700;
  }

  .od-type {
    font-size: 0.5rem;
    color: var(--muted);
    text-transform: uppercase;
  }

  .od-body {
    font-size: 0.5625rem;
    color: var(--muted);
    font-family: monospace;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 100px;
    overflow-y: auto;
    padding: 0.25rem;
    background: rgba(var(--border-rgb), 0.08);
    border: 1px solid var(--border);
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
</style>
