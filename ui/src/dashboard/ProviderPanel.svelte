<script lang="ts">
import type { MetricData, ProviderPayload } from "shared/dashboard-types";
import { onMount } from "svelte";
import Button from "../shared/ui/Button.svelte";
import { formatNumber, healthColor } from "../shared/utils.ts";
import { groupProviders } from "./group-providers.ts";
import Providers from "./Providers.svelte";

let {
  data = [] as ProviderPayload[],
  metrics = [] as MetricData[],
  overrideKey = null as string | null,
  lastProvider = null as string | null,
  lastModel = null as string | null,
  onRowClick: onRowClickCallback,
  onToggleProvider,
  defaultExpanded = false,
} = $props<{
  data?: ProviderPayload[];
  metrics?: MetricData[];
  overrideKey?: string | null;
  lastProvider?: string | null;
  lastModel?: string | null;
  onRowClick?: (metric: MetricData, allMetrics: MetricData[]) => void;
  onToggleProvider?: (provider: string, disabled: boolean) => void;
  defaultExpanded?: boolean;
}>();

let expanded = $state(false);
onMount(() => {
  if (defaultExpanded) expanded = true;
});

const groups = $derived(groupProviders(data));

const currentEntry = $derived(
  lastProvider && lastModel
    ? (data.find(
        (e: ProviderPayload) => e.name === lastProvider && e.model === lastModel
      ) ?? null)
    : null
);

const bestEntry = $derived(
  data
    .filter((e: ProviderPayload) => e.keyConfigured)
    .sort(
      (a: ProviderPayload, b: ProviderPayload) =>
        b.stabilityScore - a.stabilityScore
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
  <Button
    variant="row"
    class="panel-header"
    onclick={() => (expanded = !expanded)}
    aria-label="Toggle providers list"
  >
    <span class="panel-title">providers</span>
    <span class="panel-meta">
      <span class="panel-count">{activeCount} configured</span>
      <span class="toggle-icon">{expanded ? "▲" : "▼"}</span>
    </span>
  </Button>

  {#if expanded}
    <div class="panel-content">
      <Providers
        {data}
        {metrics}
        {overrideKey}
        onRowClick={onRowClickCallback}
        {onToggleProvider}
      />
    </div>
  {:else}
    <div class="panel-content">
      {#if groups.length === 0}
        <div class="no-data">No providers registered</div>
      {:else if displayEntry && currentGroup}
        <div class="summary-card">
          <div class="summary-top">
            <span
              class="rank-badge"
              style="background:{healthColor(currentGroup.maxScore, displayEntry.requestCount)};color:var(--bg)"
              >#1</span
            >
            <div class="summary-identity">
              <span class="provider-name">{currentGroup.displayName}</span>
              <span
                class="key-badge {currentGroup.keyConfigured ? 'active' : 'no-key'}"
              >
                {currentGroup.keyConfigured ? "active" : "no key"}
              </span>
            </div>
          </div>
          <div class="summary-metrics">
            <div class="metric-item">
              <span class="l">Latency</span>
              <span class="v"
                >{formatNumber(displayEntry.p95Latency, "ms")}</span
              >
            </div>
            <div class="metric-item">
              <span class="l">Output</span>
              <span class="v"
                >{formatNumber(displayEntry.meanTokensPerSecond)}
                t/s</span
              >
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
              <span class="badge unsupported"
                >no-{displayEntry.disabledFeatures.join(", ")}</span
              >
            {/if}
          </div>
        </div>

        {#if otherGroups.length > 0}
          <div class="other-providers">
            {#each configuredOthers as group, i}
              <span class="other-chip">#{i + 2} {group.displayName}</span>
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
    </div>
  {/if}
</div>

<style>
.provider-panel {
  border: 1px solid var(--border);
  background: var(--card);
  border-radius: var(--radius-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.panel-content {
  overflow-y: auto;
  min-height: 0;
}
:global(.panel-header) {
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: var(--surface);
  padding: 0.625rem 0.875rem;
  flex-shrink: 0;
}
.panel-title {
  font-size: var(--text-xs);
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
  font-size: var(--text-xs);
  color: var(--muted);
}
.toggle-icon {
  font-size: var(--text-xs);
  color: var(--muted);
}
.no-data {
  padding: 1rem;
  text-align: center;
  color: var(--muted);
  font-size: var(--text-base);
}
.summary-card {
  padding: 0.75rem 0.875rem;
}
.summary-top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
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
  font-size: var(--text-xs);
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
.rank-badge {
  font-size: var(--text-xs);
  font-weight: 700;
  padding: 0.125rem 0.375rem;
  flex-shrink: 0;
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
  font-size: var(--text-xs);
  color: var(--muted);
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
  font-size: var(--text-sm);
}
.model-label {
  color: var(--muted);
}
.model-name {
  font-family: var(--font-mono);
  color: var(--text);
}
.other-providers {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.875rem;
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
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
  border-radius: 2px;
}
.badge.pinned {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--text);
  border: 1px solid var(--accent);
}
.badge.tripped {
  background: rgba(var(--error-rgb), 0.15);
  color: var(--error);
}
.badge.unsupported {
  background: rgba(var(--accent-rgb), 0.15);
  color: var(--text);
}
</style>
