<script lang="ts">
import type { StatsData } from "shared/dashboard-types";
import { formatNumber, sc } from "../shared/utils";

let { data }: { data: StatsData | null } = $props();
</script>

<div class="stats-grid">
  <div class="stat">
    <span class="stat-label">Traffic</span>
    <span class="stat-value">{data?.traffic ?? "—"}</span>
  </div>
  <div class="stat">
    <span class="stat-label">Success</span>
    <span class="stat-value" style="color: {data?.successRate != null ? sc(data.successRate) : 'var(--muted)'}">{data?.successRate != null ? `${data.successRate}%` : "—"}</span>
  </div>
  <div class="stat">
    <span class="stat-label">Providers</span>
    <span class="stat-value">{data?.activeProviders ?? "—"}</span>
  </div>
  <div class="stat">
    <span class="stat-label">Latency</span>
    <span class="stat-value">{data ? formatNumber(data.avgLatency, "ms") : "—"}</span>
  </div>
</div>

<style>
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.625rem;
  }
  @media (max-width: 640px) {
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .stat {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 0.625rem 0.875rem;
  }
  .stat-label {
    font-size: 0.625rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .stat-value {
    font-size: 1.25rem;
    font-weight: 700;
    margin-top: 0.125rem;
  }
</style>
