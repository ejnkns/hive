<script lang="ts">
import type { RequestState } from "shared/dashboard-types";
import { formatNumber, formatTime } from "../../shared/utils";
import { isTerminal } from "../stage-utils";
import StagePathDots from "../StagePathDots.svelte";

let {
  requests = [] as RequestState[],
  onRequestClick,
}: {
  requests: RequestState[];
  onRequestClick?: (req: RequestState) => void;
} = $props();

function nodeColor(req: RequestState): string {
  const last = req.path.at(-1);
  if (!last) return "var(--muted)";
  if (last === "complete") return "var(--success)";
  if (last === "failed") return "var(--error)";
  return "var(--warning)";
}

function nodeLabel(req: RequestState, i: number): string {
  const last = req.path.at(-1);
  const completed = last !== undefined && isTerminal(last);
  return completed ? `#${i + 1}` : `#${i + 1} (active)`;
}
</script>

<div class="timeline">
  {#each requests as req, i}
    <div class="node-row" class:clickable={onRequestClick != null}>
      <div class="node-gutter">
        <span class="node-dot" style="background: {nodeColor(req)}"></span>
        {#if i < requests.length - 1}
          <span class="node-line"></span>
        {/if}
      </div>
      <button
        class="node-body"
        onclick={() => onRequestClick?.(req)}
        type="button"
      >
        <div class="node-header">
          <span class="node-label">{nodeLabel(req, i)}</span>
          <span class="node-time">{formatTime(req.timestamp)}</span>
        </div>
        <div class="node-meta">
          <span class="node-prov"
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
            <span class="node-latency"
              >{formatNumber(req.response.ttft, "ms")}</span
            >
          {/if}
        </div>
        {#if req.path.length > 0}
          <StagePathDots path={req.path} size="mini" />
        {/if}
      </button>
    </div>
  {/each}
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
  }

  .node-row {
    display: flex;
    gap: 0.5rem;
  }

  .node-gutter {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 10px;
  }

  .node-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 0.25rem;
  }

  .node-line {
    width: 1px;
    flex: 1;
    min-height: 8px;
    background: var(--border);
  }

  .node-body {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding-bottom: 0.5rem;
    flex: 1;
    background: none;
    border: none;
    cursor: default;
    text-align: left;
    font-family: inherit;
    color: var(--text);
  }

  .node-row.clickable .node-body {
    cursor: pointer;
  }

  .node-row.clickable .node-body:hover {
    opacity: 0.8;
  }

  .node-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: monospace;
    font-size: 0.625rem;
  }

  .node-label {
    color: var(--accent);
    font-weight: 700;
    text-transform: uppercase;
  }

  .node-time {
    color: var(--muted);
    font-size: 0.5625rem;
  }

  .node-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: monospace;
    font-size: 0.5625rem;
  }

  .node-prov {
    color: var(--accent);
    font-size: 0.5rem;
  }

  .node-latency {
    color: var(--muted);
  }
</style>
