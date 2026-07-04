<script lang="ts">
import type { CandidateInfo, FlowEvent } from "./types";
import { formatNumber, formatTime, sc } from "./utils";

let { events = [] as FlowEvent[] } = $props();

type RequestGroup = {
  prompt?: string;
  candidates?: CandidateInfo[];
  selected?: string;
  poolSize?: number;
  strategy?: string;
  response?: {
    provider: string;
    model: string;
    statusCode: number;
    success: boolean;
    ttft: number;
    totalLatency: number;
    outputTokens: number | null;
    finishReason: string | null;
    toolCallFailed: boolean;
    errorType: string | null;
  };
  failovers: { provider: string; model: string; errorType: string }[];
  timestamp: number;
};

const requests = $derived.by(() => {
  const map = new Map<string, RequestGroup>();
  for (const event of events) {
    const req = map.get(event.requestId) || { failovers: [], timestamp: 0 };
    req.timestamp = "timestamp" in event ? event.timestamp : req.timestamp;
    if (event.type === "request_received") {
      req.prompt = event.promptPreview;
      req.timestamp = event.timestamp;
    } else if (event.type === "selection_round") {
      req.candidates = event.candidates;
      req.selected = event.selected ?? undefined;
      req.poolSize = event.poolSize;
      req.strategy = event.strategy;
    } else if (event.type === "response_complete") {
      req.response = {
        provider: event.provider,
        model: event.model,
        statusCode: event.statusCode,
        success: event.success,
        ttft: event.ttft,
        totalLatency: event.totalLatency,
        outputTokens: event.outputTokens,
        finishReason: event.finishReason,
        toolCallFailed: event.toolCallFailed,
        errorType: event.errorType,
      };
    } else if (event.type === "failover_attempt") {
      req.failovers.push({
        provider: event.failedProvider,
        model: event.failedModel,
        errorType: event.errorType,
      });
    }
    map.set(event.requestId, req);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].timestamp - a[1].timestamp)
    .slice(0, 20);
});
</script>

{#if requests.length === 0}
  <div class="no-data">Awaiting requests...</div>
{:else}
  {#each requests as [, req]}
    <div class="flow-card">
      <div class="flow-header">
        <span class="flow-time">{formatTime(req.timestamp)}</span>
        <span class="flow-prompt">{req.prompt || "—"}</span>
      </div>
      {#if req.candidates && req.candidates.length > 0}
        <div class="flow-scoring">
          <div class="flow-scoring-label">Strategy: {req.strategy ?? "—"} | Pool: {String(req.poolSize ?? 0)}</div>
          {#each req.candidates as c}
            <div class="flow-row {c.key === req.selected ? 'selected' : ''}">
              <span class="flow-prov">{c.provider}</span>
              <span class="flow-model">{c.model}</span>
              {#if c.status === "eligible"}
                <span style="color:{sc(c.score)}">{c.score.toFixed(1)}%</span>
              {:else}
                <span class="badge ineligible">{c.status}</span>
              {/if}
              {#if c.affinity}<span class="badge">📌</span>{/if}
            </div>
          {/each}
        </div>
      {/if}
      {#if req.failovers.length > 0}
        <div class="flow-failovers">
          {#each req.failovers as f}
            <span class="badge failover">{f.provider}:{f.model} → {f.errorType}</span>
          {/each}
        </div>
      {/if}
      {#if req.response}
        <div class="flow-response">
          <span style="color:{req.response.success ? 'var(--success)' : 'var(--error)'}">
            {req.response.success ? String(req.response.statusCode) : `${String(req.response.statusCode)} ERR`}
          </span>
          <span>{formatNumber(req.response.ttft, "ms")} TTFT</span>
          <span>{req.response.outputTokens != null ? String(req.response.outputTokens) : "—"} tok</span>
          <span>{req.response.finishReason ?? "—"}</span>
          {#if req.response.toolCallFailed}<span class="badge tool-err">TOOL-ERR</span>{/if}
        </div>
      {/if}
    </div>
  {/each}
{/if}

<style>
  .no-data { padding: 1.5rem; text-align: center; color: var(--muted); font-size: 0.8125rem; }
  .flow-card {
    background: var(--card); border: 1px solid var(--border);
    padding: 0.5rem 0.75rem; margin-bottom: 0.5rem;
    display: flex; flex-direction: column; gap: 0.375rem;
  }
  .flow-header { display: flex; align-items: center; gap: 0.5rem; font-size: 0.6875rem; }
  .flow-time { color: var(--muted); font-family: monospace; font-size: 0.625rem; }
  .flow-prompt {
    color: var(--text); white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; max-width: 400px;
  }
  .flow-scoring {
    font-size: 0.625rem; padding: 0.25rem 0.5rem;
    background: rgba(var(--border-rgb), 0.08);
    border: 1px solid rgba(var(--border-rgb), 0.2);
    display: flex; flex-direction: column; gap: 0.125rem;
  }
  .flow-scoring-label { color: var(--muted); font-size: 0.5625rem; text-transform: uppercase; }
  .flow-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.125rem 0; }
  .flow-row.selected { color: var(--success); }
  .flow-prov { text-transform: capitalize; min-width: 70px; }
  .flow-model { font-family: monospace; color: var(--accent); font-size: 0.5625rem; }
  .flow-response {
    display: flex; align-items: center; gap: 0.75rem;
    font-size: 0.6875rem; color: var(--muted);
  }
  .flow-failovers { font-size: 0.625rem; }
  .badge {
    display: inline-block; font-size: 0.5rem; font-weight: 700;
    padding: 0.0625rem 0.25rem; text-transform: uppercase;
  }
  .badge.ineligible { color: var(--error); background: rgba(var(--error-rgb), 0.1); border: 1px solid rgba(var(--error-rgb), 0.2); }
  .badge.failover { color: #e2a93b; background: rgba(226, 169, 59, 0.1); border: 1px solid rgba(226, 169, 59, 0.2); }
  .badge.tool-err { color: var(--error); background: rgba(var(--error-rgb), 0.1); }
</style>
