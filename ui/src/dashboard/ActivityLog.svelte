<script lang="ts">
import type { MetricData } from "shared/dashboard-types";
import { formatNumber, formatTime } from "../shared/utils";

let {
  data = [] as MetricData[],
  onRowClick,
}: {
  data: MetricData[];
  onRowClick: (metric: MetricData, allMetrics: MetricData[]) => void;
} = $props();
</script>

{#if data.length === 0}
  <div class="no-data">Awaiting requests...</div>
{:else}
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Model</th>
        <th>Status</th>
        <th>Latency</th>
        <th>Tokens (I/O)</th>
      </tr>
    </thead>
    <tbody>
      {#each [...data].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50) as r}
        <tr onclick={() => onRowClick(r, data)} style="cursor:pointer">
          <td class="mono">{formatTime(r.timestamp)}</td>
          <td class="model">{r.model}</td>
          <td>
            <span class="badge {r.success ? 'ok' : 'err'}"
              >{r.statusCode ? String(r.statusCode) : "ERR"}
              {r.errorType ? ` ${r.errorType}` : ""}</span
            >
            {#if r.finishReason && r.finishReason !== "stop"}
              <span class="badge finish-{r.finishReason}"
                >{r.finishReason}</span
              >
            {/if}
            {#if r.toolCallFailed}
              <span class="badge tool-err">TOOL-ERR</span>
            {/if}
          </td>
          <td>{r.success ? formatNumber(r.ttft, "ms") : "—"}</td>
          <td>
            {r.inputTokens != null || r.outputTokens != null ? `${r.inputTokens ?? "—"} / ${r.outputTokens ?? "—"}` : "—"}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
.no-data {
  padding: 1rem;
  text-align: center;
  color: var(--muted);
  font-size: 0.75rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}
th {
  background: var(--surface);
  padding: 0.25rem 0.5rem;
  font-size: 0.5625rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: left;
  border-bottom: 2px solid var(--border);
  position: sticky;
  top: 0;
  font-weight: 700;
  z-index: 1;
}
td {
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid rgba(var(--border-rgb), 0.3);
}
tr:last-child td {
  border-bottom: none;
}
tr:hover td {
  background: rgba(var(--accent-rgb), 0.03);
}
.mono {
  font-family: monospace;
  font-size: 0.625rem;
}
.model {
  font-family: monospace;
  font-size: 0.625rem;
  color: var(--accent);
}
.badge {
  display: inline-block;
  font-size: 0.5625rem;
  font-weight: 700;
  padding: 0.0625rem 0.25rem;
  text-transform: uppercase;
  margin-right: 0.125rem;
}
.badge.ok {
  background: rgba(var(--success-rgb), 0.12);
  color: var(--success);
  border: 1px solid var(--success);
}
.badge.err {
  background: rgba(var(--error-rgb), 0.12);
  color: var(--error);
  border: 1px solid var(--error);
}
.badge.finish-length {
  background: rgba(226, 169, 59, 0.12);
  color: #e2a93b;
  border: 1px solid #e2a93b;
}
.badge.finish-content-filter {
  background: rgba(var(--error-rgb), 0.12);
  color: var(--error);
  border: 1px solid var(--error);
}
.badge.tool-err {
  background: rgba(var(--error-rgb), 0.12);
  color: var(--error);
  border: 1px solid var(--error);
}
</style>
