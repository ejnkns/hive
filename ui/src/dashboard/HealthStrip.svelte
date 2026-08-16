<script lang="ts">
import type { StatsData } from "shared/dashboard-types";
import Badge from "../shared/ui/Badge.svelte";
import { formatNumber, sc } from "../shared/utils.ts";

let {
  data,
  online = false,
}: {
  data: StatsData | null;
  online?: boolean;
} = $props();
</script>

<div class="strip" role="status">
  <Badge variant={online ? "success" : "danger"} live>
    {online ? "online" : "offline"}
  </Badge>
  <span class="stat">
    <span class="l">traffic</span>
    <span class="v">{data ? String(data.traffic) : "—"}</span>
  </span>
  <span class="stat">
    <span class="l">ok</span>
    <span
      class="v"
      style="color:{data?.successRate != null ? sc(data.successRate) : 'var(--muted)'}"
    >
      {data?.successRate != null ? `${String(data.successRate)}%` : "—"}
    </span>
  </span>
  <span class="stat">
    <span class="l">p50</span>
    <span class="v">{data ? formatNumber(data.avgLatency, "ms") : "—"}</span>
  </span>
  <span class="stat">
    <span class="l">providers</span>
    <span class="v">{data?.activeProviders ?? "—"}</span>
  </span>
  {#if data?.bestProvider && data?.bestModel}
    <span class="stat best">
      <span class="l">best</span>
      <span
        class="v"
        title={data.bestScore != null ? `score ${String(data.bestScore)}` : undefined}
      >
        {data.bestProvider}/{data.bestModel}
      </span>
    </span>
  {/if}
</div>

<style>
.strip {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.625rem 0.875rem;
  flex-wrap: wrap;
}
.stat {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}
.l {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--muted);
}
.v {
  font-size: var(--text-sm);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.stat.best {
  margin-left: auto;
}
</style>
