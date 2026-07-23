<script lang="ts">
import type { MetricData, ProviderPayload } from "shared/dashboard-types";
import { onMount } from "svelte";
import { dashboardSocket } from "./dashboard/dashboard-socket.svelte";
import type { HeaderData } from "./shared/utils";
import "./app.css";
import CanvasHost from "./canvas/CanvasHost.svelte";
import LivePipeline from "./dashboard/LivePipeline.svelte";
import Logs from "./dashboard/Logs.svelte";
import PresetsModal from "./dashboard/PresetsModal.svelte";
import ProviderPanel from "./dashboard/ProviderPanel.svelte";
import ProviderPlayground from "./dashboard/ProviderPlayground.svelte";
import Sessions from "./dashboard/Sessions.svelte";
import Stats from "./dashboard/Stats.svelte";
import {
  projectHeader,
  togglePanel,
} from "./queen-bee/project-header-state.svelte";
import ProjectIntegration from "./queen-bee/project-integration.svelte";
import ProjectOverview from "./queen-bee/project-overview.svelte";
import ProjectPage from "./queen-bee/project-page.svelte";
import BottomDrawer from "./shared/BottomDrawer.svelte";
import DetailOverlay from "./shared/DetailOverlay.svelte";
import Header from "./shared/Header.svelte";

let detailMetric: MetricData | null = $state(null);
let detailAllMetrics: MetricData[] = $state([]);
let drawerOpen = $state(false);
let presetsModalOpen = $state(false);

let currentHash = $state(window.location.hash);
onMount(() => {
  const onHashChange = () => {
    currentHash = window.location.hash;
  };
  window.addEventListener("hashchange", onHashChange);
  dashboardSocket.connect();
  return () => {
    window.removeEventListener("hashchange", onHashChange);
    dashboardSocket.disconnect();
  };
});

let headerData = $derived.by(() => {
  const p = dashboardSocket.providers;
  if (p.length === 0 && !dashboardSocket.connected)
    return null as HeaderData | null;
  const sorted = p
    .filter((x) => x.keyConfigured)
    .sort((a, b) => b.stabilityScore - a.stabilityScore);
  const bestEntry = sorted[0] ?? null;
  const total = dashboardSocket.metrics.length;
  const okCount = dashboardSocket.metrics.filter((r) => r.success).length;
  const rate = total > 0 ? Math.round((okCount / total) * 100) : null;
  const names = new Set(p.filter((x) => x.keyConfigured).map((x) => x.name));
  const flights = dashboardSocket.metrics
    .filter((r) => r.success)
    .map((r) => r.ttft);
  const avg =
    flights.length > 0
      ? Math.round(flights.reduce((a, b) => a + b, 0) / flights.length)
      : null;
  return {
    online: dashboardSocket.connected,
    serverAddr: `${dashboardSocket.serverHost}:${dashboardSocket.serverPort}`,
    lastProvider: null,
    lastModel: null,
    override: dashboardSocket.override,
    availableProviders: dashboardSocket.availableProviders,
    bestProvider: bestEntry?.name ?? null,
    bestModel: bestEntry?.model ?? null,
    bestScore: bestEntry?.stabilityScore ?? null,
    routingStrategy: dashboardSocket.routingStrategy,
    contextWindowWeight: dashboardSocket.contextWindowWeight,
    traffic: total,
    successRate: rate,
    activeProviders: names.size,
    avgLatency: avg,
  };
});

let statsData = $derived.by(() => {
  const p = dashboardSocket.providers;
  if (p.length === 0 && !dashboardSocket.connected) return null;
  const total = dashboardSocket.metrics.length;
  const okCount = dashboardSocket.metrics.filter((r) => r.success).length;
  const rate = total > 0 ? Math.round((okCount / total) * 100) : null;
  const flights = dashboardSocket.metrics
    .filter((r) => r.success)
    .map((r) => r.ttft);
  const avg =
    flights.length > 0
      ? Math.round(flights.reduce((a, b) => a + b, 0) / flights.length)
      : null;
  const names = new Set(p.filter((x) => x.keyConfigured).map((x) => x.name));
  const sorted = p
    .filter((x) => x.keyConfigured)
    .sort((a, b) => b.stabilityScore - a.stabilityScore);
  const bestEntry = sorted[0] ?? null;
  return {
    traffic: total,
    successRate: rate,
    activeProviders: names.size,
    avgLatency: avg,
    bestProvider: bestEntry?.name ?? null,
    bestModel: bestEntry?.model ?? null,
    bestScore: bestEntry?.stabilityScore ?? null,
  };
});

let providersData = $derived.by((): ProviderPayload[] => {
  return dashboardSocket.providers.map((x) => ({
    name: x.name,
    displayName: x.displayName,
    model: x.model,
    keyConfigured: x.keyConfigured,
    stabilityScore: x.stabilityScore,
    subscores: x.subscores,
    p95Latency: x.p95Latency,
    meanTokensPerSecond: x.meanTokensPerSecond,
    requestCount: x.requestCount,
    recentSuccessRate: x.recentSuccessRate,
    truncationRate: x.truncationRate,
    refusalRate: x.refusalRate,
    contentFilterRate: x.contentFilterRate,
    trippedUntil: x.trippedUntil,
    disabledFeatures: x.disabledFeatures,
    disabled: x.disabled,
  }));
});

let overrideKey = $derived(
  dashboardSocket.override.active &&
    dashboardSocket.override.provider &&
    dashboardSocket.override.model
    ? `${dashboardSocket.override.provider}:${dashboardSocket.override.model}`
    : null
);

function handleMetricClick(metric: MetricData, allMetrics: MetricData[]) {
  detailMetric = metric;
  detailAllMetrics = allMetrics;
}

function handleOverrideSet(provider: string, model: string) {
  dashboardSocket.setOverride(provider, model);
}

function handleOverrideClear() {
  const o = dashboardSocket.override;
  if (o.provider && o.model) {
    dashboardSocket.clearOverride(o.provider, o.model);
  }
}

function handleToggleProvider(provider: string, disabled: boolean) {
  dashboardSocket.toggleProvider(provider, disabled);
}
</script>

<div class="app">
  <div class="top-bar">
    <Header
      data={headerData ?? undefined}
      onOverrideSet={handleOverrideSet}
      onOverrideClear={handleOverrideClear}
      onOpenPresets={() => (presetsModalOpen = true)}
    />
    {#if currentHash.startsWith('#/project/') && projectHeader.projectId}
      <div class="project-header">
        <div class="project-header-row">
          <a href="#/" class="back-link">&larr; Projects</a>
          <div class="header-right">
            {#key projectHeader.projectId}
              <ProjectIntegration projectId={projectHeader.projectId} />
            {/key}
            {#if projectHeader.requirementsContent}
              <button
                type="button"
                class="btn btn-outline"
                onclick={togglePanel}
              >
                {projectHeader.panelOpen ? "Hide" : "View"}
                Requirements
              </button>
            {/if}
            <span class="project-id">{projectHeader.projectId}</span>
          </div>
        </div>
        {#if projectHeader.requirementsContent && projectHeader.panelOpen}
          <div class="requirements-panel">
            <div class="panel-header">
              <h2>Requirements</h2>
            </div>
            <div class="panel-body">
              <pre class="req-content">{projectHeader.requirementsContent}</pre>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if currentHash === '#/canvas'}
    <CanvasHost />
  {:else if currentHash === '#/dashboard'}
    <div class="content">
      <Stats data={statsData} />
      <div>
        <div class="section-head" style="margin-top:1.5rem">Live Sessions</div>
        <Sessions sessions={dashboardSocket.sessions} />
        <ProviderPanel
          data={providersData}
          metrics={dashboardSocket.metrics}
          conversations={[]}
          {overrideKey}
          onRowClick={handleMetricClick}
          onToggleProvider={handleToggleProvider}
          lastProvider={headerData?.lastProvider ?? null}
          lastModel={headerData?.lastModel ?? null}
        />
      </div>
      <div class="section-head" style="margin-top:1.5rem">Pipeline</div>
      <LivePipeline
        events={dashboardSocket.flowEvents}
        providers={providersData}
      />
      <Logs entries={dashboardSocket.logEntries} />
    </div>
    <BottomDrawer bind:open={drawerOpen} title="Provider playground">
      <ProviderPlayground providers={dashboardSocket.availableProviders} />
    </BottomDrawer>
    <DetailOverlay {detailMetric} {detailAllMetrics} />
    <PresetsModal bind:open={presetsModalOpen} />
  {:else if currentHash.startsWith('#/project/')}
    <ProjectPage projectId={currentHash.slice('#/project/'.length)} />
  {:else}
    <ProjectOverview />
  {/if}
</div>

<style>
.app {
  display: block;
}
.top-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.project-header {
  max-width: 900px;
  margin: 0 auto;
  padding: 0.75rem 1.25rem 0.75rem;
}
.project-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.back-link {
  font-size: 0.8125rem;
  color: var(--muted);
  text-decoration: none;
}
.back-link:hover {
  color: var(--text);
}
.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.project-id {
  font-size: 0.75rem;
  color: var(--muted);
  font-family: var(--font-mono, monospace);
}
.btn {
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 0.6875rem;
  font-weight: 500;
  cursor: pointer;
  background: var(--surface);
  color: var(--text);
  white-space: nowrap;
}
.btn:hover:not(:disabled) {
  background: var(--border);
}
.btn-outline {
  background: transparent;
}
.requirements-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-top: 0.5rem;
  overflow: hidden;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
}
.panel-header h2 {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}
.panel-body {
  max-height: 300px;
  overflow-y: auto;
}
.req-content {
  padding: 0.75rem 1rem;
  margin: 0;
  font-size: 0.6875rem;
  font-family: var(--font-mono, monospace);
  color: var(--text);
  white-space: pre-wrap;
  line-height: 1.5;
}
.content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.25rem;
}
.section-head {
  font-size: 0.625rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  margin-bottom: 0.5rem;
}
</style>
