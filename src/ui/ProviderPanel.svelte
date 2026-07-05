<script lang="ts">
import type { ConversationData, MetricData, ProviderData } from "./types";
import { bar, formatNumber, sc } from "./utils";
import Providers from "./Providers.svelte";

let {
  data = [] as ProviderData[],
  metrics = [] as MetricData[],
  conversations = [] as ConversationData[],
  overrideKey = null as string | null,
  lastProvider = null as string | null,
  lastModel = null as string | null,
  onRowClick: onRowClickCallback,
} = $props<{
  data?: ProviderData[];
  metrics?: MetricData[];
  conversations?: ConversationData[];
  overrideKey?: string | null;
  lastProvider?: string | null;
  lastModel?: string | null;
  onRowClick?: (metric: MetricData, allMetrics: MetricData[]) => void;
}>();

let expanded = $state(false);

const groups = $derived.by(() => {
  const grouped = new Map<string, ProviderData[]>();
  data.forEach((x: ProviderData) => {
    const existing = grouped.get(x.name);
    if (existing) existing.push(x);
    else grouped.set(x.name, [x]);
  });
  return Array.from(grouped.entries())
    .map(([name, entries]) => {
      const maxScore = Math.max(...entries.map((e) => e.stabilityScore));
      const keyConfigured = entries.some((e) => e.keyConfigured);
      return {
        name,
        displayName: entries[0].displayName || name,
        entries,
        maxScore,
        keyConfigured,
      };
    })
    .sort((a, b) => {
      if (a.keyConfigured && !b.keyConfigured) return -1;
      if (!a.keyConfigured && b.keyConfigured) return 1;
      return b.maxScore - a.maxScore;
    });
});

const currentEntry = $derived(
  lastProvider && lastModel
    ? (data.find(
        (e: ProviderData) => e.name === lastProvider && e.model === lastModel
      ) ?? null)
    : null
);

const bestEntry = $derived(
  data
    .filter((e: ProviderData) => e.keyConfigured)
    .sort(
      (a: ProviderData, b: ProviderData) => b.stabilityScore - a.stabilityScore
    )[0] ?? null
);

const displayEntry = $derived(currentEntry ?? bestEntry);

const currentGroup = $derived(
  displayEntry
    ? (groups.find((g) => g.entries.includes(displayEntry)) ?? null)
    : null
);

const otherGroups = $derived(groups.filter((g) => g !== currentGroup));

const activeCount = $derived(groups.filter((g) => g.keyConfigured).length);

const configuredOthers = $derived(otherGroups.filter((g) => g.keyConfigured));
const unconfiguredCount = $derived(
  otherGroups.filter((g) => !g.keyConfigured).length
);

const displayEntryTripped = $derived(
  displayEntry?.trippedUntil && displayEntry.trippedUntil > Date.now()
);

const isPinned = $derived(
  overrideKey && displayEntry
    ? overrideKey === `${displayEntry.name}:${displayEntry.model}`
    : false
);
</script>

<div class="provider-panel">
  <div
    class="panel-header" role="button" tabindex="0"
    onclick={() => (expanded = !expanded)}
    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (expanded = !expanded)}
  >
    <span class="panel-title">Providers</span>
    <span class="panel-meta">
      <span class="panel-count">{activeCount} configured</span>
      <span class="toggle-icon">{expanded ? "▲" : "▼"}</span>
    </span>
  </div>

  {#if expanded}
    <Providers {data} {metrics} {conversations} {overrideKey} onRowClick={onRowClickCallback} />
  {:else}
    {#if groups.length === 0}
      <div class="no-data">No providers registered</div>
    {:else if displayEntry && currentGroup}
      <div class="summary-card">
        <div class="summary-top">
          <div class="summary-identity">
            <span class="provider-name">{currentGroup.displayName}</span>
            <span class="key-badge {currentGroup.keyConfigured ? 'active' : 'no-key'}">
              {currentGroup.keyConfigured ? "active" : "no key"}
            </span>
          </div>
          <div class="summary-scores">
            <span class="score" style="color:{sc(currentGroup.maxScore)}">{currentGroup.maxScore.toFixed(2)}%</span>
            <span class="bar-text" style="color:{sc(currentGroup.maxScore)}">{bar(currentGroup.maxScore)}</span>
          </div>
        </div>
        <div class="summary-metrics">
          <div class="metric-item">
            <span class="l">Latency</span>
            <span class="v">{formatNumber(displayEntry.p95Latency, "ms")}</span>
          </div>
          <div class="metric-item">
            <span class="l">Output</span>
            <span class="v">{formatNumber(displayEntry.meanTokensPerSecond)} t/s</span>
          </div>
          <div class="metric-item">
            <span class="l">Calls</span>
            <span class="v">{displayEntry.requestCount}</span>
          </div>
        </div>
        <div class="summary-model">
          <span class="model-label">model: </span>
          <span class="model-name">{displayEntry.model}</span>
          {#if isPinned}
            <span class="badge pinned">pinned</span>
          {/if}
          {#if displayEntryTripped}
            <span class="badge tripped">cooldown</span>
          {/if}
          {#if displayEntry.disabledFeatures && displayEntry.disabledFeatures.length > 0}
            <span class="badge unsupported">no-{displayEntry.disabledFeatures.join(", ")}</span>
          {/if}
        </div>
      </div>

      {#if otherGroups.length > 0}
        <div class="other-providers">
          {#each configuredOthers as group, i}
            <span class="other-chip">{group.displayName} {group.maxScore.toFixed(0)}%</span>
            {#if i < configuredOthers.length - 1}
              <span class="sep">·</span>
            {/if}
          {/each}
          {#if unconfiguredCount > 0}
            {#if configuredOthers.length > 0}
              <span class="sep">·</span>
            {/if}
            <span class="other-chip muted">{unconfiguredCount} no key</span>
          {/if}
        </div>
      {/if}
    {:else}
      <div class="no-data">No active provider</div>
    {/if}
  {/if}
</div>

<style>
  .provider-panel {
    border: 1px solid var(--border);
    background: var(--card);
  }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.625rem 0.875rem;
    cursor: pointer;
    user-select: none;
  }
  .panel-header:hover {
    background: rgba(var(--border-rgb), 0.1);
  }
  .panel-title {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
    color: var(--muted);
  }
  .panel-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .panel-count {
    font-size: 0.5625rem;
    color: var(--muted);
  }
  .toggle-icon {
    font-size: 0.625rem;
    color: var(--muted);
  }
  .no-data {
    padding: 1rem;
    text-align: center;
    color: var(--muted);
    font-size: 0.8125rem;
  }
  .summary-card {
    padding: 0.75rem 0.875rem;
  }
  .summary-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .summary-identity {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .provider-name {
    font-size: 1rem;
    font-weight: 700;
  }
  .key-badge {
    font-size: 0.5625rem;
    padding: 0.0625rem 0.375rem;
    font-weight: 700;
    border: 1px solid currentColor;
  }
  .key-badge.active {
    color: var(--success);
    border-color: var(--success);
    background: rgba(var(--success-rgb), 0.08);
  }
  .key-badge.no-key {
    color: var(--muted);
    border-color: var(--border);
    background: transparent;
  }
  .summary-scores {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .score {
    font-size: 0.75rem;
    font-weight: 700;
    min-width: 2.5rem;
  }
  .bar-text {
    font-family: monospace;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    line-height: 1;
  }
  .summary-metrics {
    display: flex;
    gap: 1.5rem;
    margin-top: 0.375rem;
  }
  .metric-item {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 60px;
  }
  .metric-item .l {
    font-size: 0.5625rem;
    color: var(--muted);
    text-transform: uppercase;
  }
  .metric-item .v {
    font-size: 0.875rem;
    font-weight: 600;
  }
  .summary-model {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.25rem;
    font-size: 0.75rem;
  }
  .model-label {
    color: var(--muted);
  }
  .model-name {
    font-family: monospace;
    color: var(--accent);
  }
  .other-providers {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0.875rem;
    border-top: 1px solid var(--border);
    font-size: 0.6875rem;
    color: var(--muted);
    flex-wrap: wrap;
  }
  .other-chip {
    font-weight: 500;
  }
  .other-chip.muted {
    opacity: 0.5;
  }
  .sep {
    opacity: 0.4;
  }
  .badge {
    display: inline-block;
    font-size: 0.5rem;
    font-weight: 700;
    padding: 0.0625rem 0.25rem;
    text-transform: uppercase;
    border-radius: 2px;
  }
  .badge.pinned {
    background: rgba(var(--accent-rgb), 0.15);
    color: var(--accent);
    border: 1px solid var(--accent);
  }
  .badge.tripped {
    background: rgba(var(--error-rgb), 0.15);
    color: var(--error);
  }
  .badge.unsupported {
    background: rgba(var(--accent-rgb), 0.15);
    color: var(--accent);
  }
</style>
