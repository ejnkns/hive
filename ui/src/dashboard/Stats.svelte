<script lang="ts">
import type { StatsData } from "shared/dashboard-types";
import Card from "../shared/ui/Card.svelte";
import { formatNumber, sc } from "../shared/utils";

let { data }: { data: StatsData | null } = $props();
</script>

<div class="stats-grid">
  <Card>
    <div class="stat">
      <span class="stat-label">Traffic</span>
      <span class="stat-value">{data?.traffic ?? "—"}</span>
    </div>
  </Card>
  <Card>
    <div class="stat">
      <span class="stat-label">Success</span>
      <span
        class="stat-value"
        style="color: {data?.successRate != null ? sc(data.successRate) : 'var(--muted)'}"
        >{data?.successRate != null ? `${data.successRate}%` : "—"}</span
      >
    </div>
  </Card>
  <Card>
    <div class="stat">
      <span class="stat-label">Providers</span>
      <span class="stat-value">{data?.activeProviders ?? "—"}</span>
    </div>
  </Card>
  <Card>
    <div class="stat">
      <span class="stat-label">Latency</span>
      <span class="stat-value"
        >{data ? formatNumber(data.avgLatency, "ms") : "—"}</span
      >
    </div>
  </Card>
</div>

<style>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.625rem;
}
@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
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
