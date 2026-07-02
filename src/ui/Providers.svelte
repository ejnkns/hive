<script lang="ts">
import type { ProviderData, MetricData, ConversationData, CandidateInfo } from "./types";
import { bar, formatNumber, sc } from "./utils";
import ActivityLog from "./ActivityLog.svelte";
import Conversations from "./Conversations.svelte";

let {
  data = [] as ProviderData[],
  metrics = [] as MetricData[],
  conversations = [] as ConversationData[],
  overrideKey = null as string | null,
} = $props();

let expandedConsoles = $state(new Set<string>());
let expandedModels = $state(new Set<string>());
let activeTabs = $state(new Map<string, "activity" | "conversations">());

const groups = $derived.by(() => {
  const grouped = new Map<string, ProviderData[]>();
  data.forEach((x) => {
    const existing = grouped.get(x.name);
    if (existing) existing.push(x);
    else grouped.set(x.name, [x]);
  });
  return Array.from(grouped.entries())
    .map(([name, entries]) => {
      const maxScore = Math.max(...entries.map((e) => e.stabilityScore));
      const keyConfigured = entries.some((e) => e.keyConfigured);
      return { name, displayName: entries[0].displayName || name, entries, maxScore, keyConfigured };
    })
    .sort((a, b) => {
      if (a.keyConfigured && !b.keyConfigured) return -1;
      if (!a.keyConfigured && b.keyConfigured) return 1;
      return b.maxScore - a.maxScore;
    });
});

// Live cooldown ticker
let tick = $state(0);
$effect(() => {
  const hasTripped = data.some((e) => e.trippedUntil && e.trippedUntil > Date.now());
  if (!hasTripped) return;
  const interval = setInterval(() => {
    tick++;
  }, 1000);
  return () => clearInterval(interval);
});

function toggleModels(name: string) {
  if (expandedModels.has(name)) expandedModels.delete(name);
  else expandedModels.add(name);
  expandedModels = expandedModels;
}

function toggleConsole(name: string) {
  if (expandedConsoles.has(name)) expandedConsoles.delete(name);
  else expandedConsoles.add(name);
  expandedConsoles = expandedConsoles;
}

function switchTab(name: string, tab: "activity" | "conversations") {
  activeTabs.set(name, tab);
  activeTabs = activeTabs;
}
</script>

{#if groups.length === 0}
  <div class="no-data">No providers registered</div>
{:else}
  {#each groups as group}
    {@const f = group.entries[0]}
    {@const isExpanded = expandedConsoles.has(group.name)}
    {@const isModelsExpanded = expandedModels.has(group.name)}
    {@const activeTab = activeTabs.get(group.name) || "activity"}
    <div class="worker" style="opacity:{group.keyConfigured ? '1' : '0.4'}">
      <div class="worker-summary">
        <div class="worker-identity">
          <span class="worker-name">{group.displayName}</span>
          <span class="key-badge {group.keyConfigured ? 'active' : 'no-key'}">{group.keyConfigured ? "active" : "no key"}</span>
        </div>
        <div class="sbar">
          <span class="score" style="color:{sc(group.maxScore)}">{group.maxScore.toFixed(2)}%</span>
          <span class="bar-text" style="color:{sc(group.maxScore)}">{bar(group.maxScore)}</span>
        </div>
        <div class="wmet">
          <div class="wmet-item"><span class="l">Latency</span><span class="v">{formatNumber(f.p95Latency, "ms")}</span></div>
          <div class="wmet-item"><span class="l">Output</span><span class="v">{formatNumber(f.meanTokensPerSecond)} t/s</span></div>
          <div class="wmet-item"><span class="l">Calls</span><span class="v">{f.requestCount}</span></div>
        </div>
      </div>

      <div class="models-section">
        <div class="models-toggle" onclick={() => toggleModels(group.name)}>
          <span>Models ({group.entries.length})</span>
          <span class="toggle-icon">{isModelsExpanded ? "▲" : "▼"}</span>
        </div>
        {#if isModelsExpanded}
          <div class="mrows">
            {#each group.entries as e}
              {@const sub = e.subscores}
              {@const tripped = e.trippedUntil && e.trippedUntil > Date.now()}
              {@const cooldownSec = tripped && e.trippedUntil ? Math.round((e.trippedUntil - Date.now()) / 1000) : 0}
              {@const isPinned = overrideKey === `{e.name}:{e.model}`}
              <div class="mrow {isPinned ? 'pinned' : ''}">
                <div class="mrow-top">
                  <span class="mname">
                    {e.model}
                    {#if isPinned}<span class="badge pinned">pinned</span>{/if}
                    {#if tripped}<span class="badge tripped" data-tripped-until={e.trippedUntil}>🛑 {cooldownSec}s</span>{/if}
                    {#if e.disabledFeatures && e.disabledFeatures.length > 0}
                      <span class="badge unsupported">no-{e.disabledFeatures.join(", ")}</span>
                    {/if}
                  </span>
                  <span class="mstats">
                    <span style="color:{sc(e.stabilityScore)}">{e.stabilityScore.toFixed(2)}%</span>
                    <span>{formatNumber(e.p95Latency, "ms")}</span>
                    <span>{formatNumber(e.meanTokensPerSecond)} t/s</span>
                    <span>{String(e.requestCount)}c</span>
                  </span>
                </div>
                {#if sub}
                  <div class="sub-bars">
                    <div class="sub-bar"><span class="sub-label">L</span><span class="sub-fill" style="width:{sub.latency.toFixed(0)}%;background:{sc(sub.latency)}"></span></div>
                    <div class="sub-bar"><span class="sub-label">T</span><span class="sub-fill" style="width:{sub.throughput.toFixed(0)}%;background:{sc(sub.throughput)}"></span></div>
                    <div class="sub-bar"><span class="sub-label">R</span><span class="sub-fill" style="width:{sub.reliability.toFixed(0)}%;background:{sc(sub.reliability)}"></span></div>
                    <div class="sub-bar"><span class="sub-label">Q</span><span class="sub-fill" style="width:{sub.quality.toFixed(0)}%;background:{sc(sub.quality)}"></span></div>
                    <div class="sub-bar"><span class="sub-label">C</span><span class="sub-fill" style="width:{sub.contextWindow.toFixed(0)}%;background:{sc(sub.contextWindow)}"></span></div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      {#if group.keyConfigured}
        <div class="console-section">
          <div class="console-toggle" onclick={() => toggleConsole(group.name)}>
            <span>Provider Console</span>
            <span class="toggle-icon">{isExpanded ? "▲" : "▼"}</span>
          </div>
          {#if isExpanded}
            <div class="console-content">
              <div class="tab-bar">
                <span class="tab {activeTab === 'activity' ? 'active' : ''}" onclick={() => switchTab(group.name, "activity")}>Recent Activity</span>
                <span class="tab {activeTab === 'conversations' ? 'active' : ''}" onclick={() => switchTab(group.name, "conversations")}>Conversations</span>
              </div>
              <div class="tab-content">
                {#if activeTab === "activity"}
                  <ActivityLog data={metrics.filter((m) => m.provider === group.name)} />
                {:else}
                  <Conversations data={conversations.filter((c) => c.provider === group.name)} />
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
{/if}

<style>
  .no-data { padding: 1.5rem; text-align: center; color: var(--muted); font-size: 0.8125rem; }
  .worker { background: var(--card); border: 1px solid var(--border); padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .worker-summary { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
  .worker-identity { display: flex; align-items: center; gap: 0.5rem; min-width: 150px; }
  .worker-name { font-size: 1.125rem; font-weight: 700; }
  .key-badge { font-size: 0.5625rem; padding: 0.0625rem 0.375rem; font-weight: 700; border: 1px solid currentColor; }
  .key-badge.active { color: var(--success); border-color: var(--success); background: rgba(var(--success-rgb), 0.08); }
  .key-badge.no-key { color: var(--muted); border-color: var(--border); background: transparent; }
  .sbar { display: flex; align-items: center; gap: 0.5rem; min-width: 180px; }
  .score { font-size: 0.75rem; font-weight: 700; min-width: 2.5rem; }
  .bar-text { font-family: monospace; font-size: 0.75rem; letter-spacing: 0.05em; line-height: 1; }
  .wmet { display: flex; gap: 1.5rem; }
  .wmet-item { display: flex; flex-direction: column; gap: 0.125rem; min-width: 60px; }
  .wmet-item .l { font-size: 0.5625rem; color: var(--muted); text-transform: uppercase; }
  .wmet-item .v { font-size: 0.875rem; font-weight: 600; }

  .models-section { border-top: 1px solid var(--border); padding-top: 0.5rem; }
  .models-toggle {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 0.6875rem; font-weight: 700; color: var(--muted);
    text-transform: uppercase; cursor: pointer; padding: 0.25rem 0.5rem;
    background: rgba(var(--border-rgb), 0.15); user-select: none;
  }
  .models-toggle:hover { color: var(--accent); background: rgba(var(--border-rgb), 0.25); }
  .mrows { border-top: 1px solid var(--border); padding-top: 0.5rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.5rem; }
  .mrow { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; padding: 0.25rem 0.5rem; background: rgba(var(--border-rgb), 0.1); border: 1px solid rgba(var(--border-rgb), 0.3); }
  .mrow.pinned { outline: 1px solid var(--accent); outline-offset: -1px; }
  .mrow-top { display: flex; justify-content: space-between; }
  .mname { color: var(--accent); font-family: monospace; font-size: 0.6875rem; font-weight: 500; display: inline-flex; align-items: center; gap: 0.25rem; }
  .mstats { display: flex; gap: 0.75rem; color: var(--muted); font-size: 0.625rem; }
  .mstats span { white-space: nowrap; }
  .sub-bars { display: flex; gap: 0.25rem; }
  .sub-bar { display: flex; align-items: center; gap: 0.125rem; flex: 1; }
  .sub-label { font-size: 0.5rem; font-weight: 700; color: var(--muted); width: 10px; text-align: center; }
  .sub-fill { height: 4px; border-radius: 0; display: inline-block; }

  .console-section { border-top: 1px solid var(--border); padding-top: 0.5rem; }
  .console-toggle {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 0.6875rem; font-weight: 700; color: var(--muted);
    text-transform: uppercase; cursor: pointer; padding: 0.25rem 0.5rem;
    background: rgba(var(--border-rgb), 0.15); user-select: none;
  }
  .console-toggle:hover { color: var(--accent); background: rgba(var(--border-rgb), 0.25); }
  .console-content { margin-top: 0.5rem; border: 1px solid var(--border); background: var(--bg); }
  .tab-bar { display: flex; background: var(--card); border-bottom: 1px solid var(--border); }
  .tab {
    font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.08em;
    font-weight: 700; cursor: pointer; padding: 0.375rem 0.75rem;
    color: var(--muted); border-right: 1px solid var(--border);
  }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); background: var(--card); }
  .tab-content { height: 250px; overflow: hidden; overflow-y: auto; }

  .badge { display: inline-block; font-size: 0.5rem; font-weight: 700; padding: 0.0625rem 0.25rem; text-transform: uppercase; border-radius: 2px; }
  .badge.tripped { background: rgba(var(--error-rgb), 0.15); color: var(--error); }
  .badge.unsupported { background: rgba(var(--accent-rgb), 0.15); color: var(--accent); }
  .badge.pinned { background: rgba(var(--accent-rgb), 0.15); color: var(--accent); border: 1px solid var(--accent); }
</style>
