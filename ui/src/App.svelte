<script lang="ts">
import type { MetricData } from "shared/dashboard-types";
import { onMount } from "svelte";
import { dashboardSocket } from "./dashboard/dashboard-socket.svelte";
import type { HeaderData } from "./shared/utils.ts";
import { formatNumber, formatTime } from "./shared/utils.ts";
import "./app.css";
import CanvasHost from "./canvas/CanvasHost.svelte";
import HealthStrip from "./dashboard/HealthStrip.svelte";
import LivePipeline from "./dashboard/LivePipeline.svelte";
import Logs from "./dashboard/Logs.svelte";
import ModelPriorityModal from "./dashboard/ModelPriorityModal.svelte";
import PlaygroundPage from "./dashboard/PlaygroundPage.svelte";
import ProviderPanel from "./dashboard/ProviderPanel.svelte";
import Sessions from "./dashboard/Sessions.svelte";
import Landing from "./landing/Landing.svelte";
import Settings from "./settings/Settings.svelte";
import BottomBar from "./shared/BottomBar.svelte";
import Header from "./shared/Header.svelte";
import Dialog from "./shared/ui/Dialog.svelte";
import DefinitionEditor from "./workflow/DefinitionEditor.svelte";
import FlowDefinitionPage from "./workflow/FlowDefinitionPage.svelte";
import FlowDefinitionView from "./workflow/FlowDefinitionView.svelte";
import FlowInstancePage from "./workflow/FlowInstancePage.svelte";
import FlowLibrary from "./workflow/FlowLibrary.svelte";
import type { FlowRoute } from "./workflow/flow-breadcrumb.ts";
import { flowBreadcrumb } from "./workflow/flow-breadcrumb.ts";
import { flowStore } from "./workflow/flow-store.svelte";
import InstantiateForm from "./workflow/InstantiateForm.svelte";

let detailMetric: MetricData | null = $state(null);
let detailAllMetrics: MetricData[] = $state([]);
let modelPriorityOpen = $state(false);

let currentHash = $state(window.location.hash);
onMount(() => {
  const onHashChange = () => {
    currentHash = window.location.hash;
  };
  window.addEventListener("hashchange", onHashChange);
  dashboardSocket.connect();
  flowStore.connect();
  return () => {
    window.removeEventListener("hashchange", onHashChange);
    dashboardSocket.disconnect();
    flowStore.disconnect();
  };
});

function parseFlowRoute(hash: string): FlowRoute | null {
  if (hash === "#/flows") {
    return { kind: "library" };
  }
  if (hash === "#/flows/new") {
    return { kind: "new-definition" };
  }
  const match = hash.match(/^#\/flows\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  const flowNameRaw = match[1];
  if (flowNameRaw === undefined) return null;
  const flowName = decodeURIComponent(flowNameRaw);
  const rest = match[2];
  if (rest === undefined) return { kind: "definition", flowName };
  if (rest === "edit") return { kind: "edit-definition", flowName };
  if (rest === "view") return { kind: "view-definition", flowName };
  if (rest === "new") return { kind: "new-instance", flowName };
  return { kind: "instance", flowName, instanceName: decodeURIComponent(rest) };
}

const flowRoute = $derived(parseFlowRoute(currentHash));

// The instance route's flow snapshot, resolved reactively from the store so
// the breadcrumb leaf shows the pretty instance name (config.name) instead of
// the URL slug. Null on non-instance routes and until the store hydrates.
const instanceFlow = $derived.by(() => {
  if (flowRoute?.kind !== "instance") return null;
  return flowStore.findFlow(flowRoute.flowName, flowRoute.instanceName);
});

const instanceLabel = $derived.by(() => {
  if (!instanceFlow) return undefined;
  const name = instanceFlow.config?.name;
  return typeof name === "string" ? name : instanceFlow.id;
});

const breadcrumbs = $derived(
  flowRoute ? flowBreadcrumb(flowRoute, instanceLabel) : []
);

function canvasEnabled(): boolean {
  try {
    return localStorage.getItem("hive-canvas-enabled") !== "0";
  } catch {
    return true;
  }
}

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

const detailOpen = $derived(detailMetric !== null);
const detailChain = $derived(
  detailMetric && detailAllMetrics.length > 0
    ? detailAllMetrics
        .filter((m) => m.requestId === detailMetric?.requestId)
        .sort((a, b) => a.timestamp - b.timestamp)
    : []
);
</script>

<div class="app">
  <div class="top-bar">
    <Header>
      {#if breadcrumbs.length > 0}
        <nav class="breadcrumb" aria-label="breadcrumb">
          {#each breadcrumbs as crumb, index}
            {#if index > 0}
              <span class="crumb-sep">/</span>
            {/if}
            {#if crumb.href !== undefined}
              <a class="crumb-link" href={crumb.href}>{crumb.label}</a>
            {:else}
              <span class="crumb-current">{crumb.label}</span>
            {/if}
          {/each}
        </nav>
      {/if}
    </Header>
  </div>

  <main class="app-content">
    {#if currentHash === '#/canvas'}
      {#if canvasEnabled()}
        <CanvasHost />
      {:else}
        <Landing />
      {/if}
    {:else if currentHash === '#/dashboard'}
      <div class="dash">
        <section class="dash-strip" aria-label="System health">
          <HealthStrip data={statsData} online={dashboardSocket.connected} />
        </section>
        <section class="dash-board" aria-label="Pipeline">
          <div class="panel-head"><h2>pipeline</h2></div>
          <div class="board-scroll">
            <LivePipeline
              events={dashboardSocket.flowEvents}
              providers={dashboardSocket.providers}
            />
          </div>
        </section>
        <section class="dash-sessions" aria-label="Live sessions">
          <div class="panel-head"><h2>live sessions</h2></div>
          <Sessions sessions={dashboardSocket.sessions} />
        </section>
        <section class="dash-providers" aria-label="Providers">
          <ProviderPanel
            data={dashboardSocket.providers}
            metrics={dashboardSocket.metrics}
            {overrideKey}
            onRowClick={handleMetricClick}
            onToggleProvider={handleToggleProvider}
            lastProvider={headerData?.lastProvider ?? null}
            lastModel={headerData?.lastModel ?? null}
            defaultExpanded={true}
          />
        </section>
        <section class="dash-logs" aria-label="Logs">
          <Logs entries={dashboardSocket.logEntries} />
        </section>
      </div>
      <Dialog
        open={detailOpen}
        onOpenChange={(v) => { if (!v) detailMetric = null }}
        label="request detail"
      >
        <h2 class="dialog-title">request detail</h2>
        {#if detailMetric}
          <div class="detail-grid">
            <div class="field">
              <span class="label">request id</span
              ><span class="val mono">{detailMetric.requestId}</span>
            </div>
            <div class="field">
              <span class="label">provider</span
              ><span class="val">{detailMetric.provider}</span>
            </div>
            <div class="field">
              <span class="label">model</span
              ><span class="val mono">{detailMetric.model}</span>
            </div>
            <div class="field">
              <span class="label">time</span
              ><span class="val">{formatTime(detailMetric.timestamp)}</span>
            </div>
            <div class="field">
              <span class="label">TTFT</span
              ><span class="val">{formatNumber(detailMetric.ttft, "ms")}</span>
            </div>
            <div class="field">
              <span class="label">total</span
              ><span class="val"
                >{formatNumber(detailMetric.totalLatency, "ms")}</span
              >
            </div>
            <div class="field">
              <span class="label">tokens i/o</span
              ><span class="val"
                >{detailMetric.inputTokens ?? "—"}
                / {detailMetric.outputTokens ?? "—"}</span
              >
            </div>
            <div class="field">
              <span class="label">thinking</span
              ><span class="val"
                >{detailMetric.thinkingTime != null ? `${detailMetric.thinkingTime}ms` : "—"}</span
              >
            </div>
            <div class="field">
              <span class="label">status</span
              ><span class="val {detailMetric.success ? 'ok' : 'err'}"
                >{String(detailMetric.statusCode)}</span
              >
            </div>
            <div class="field">
              <span class="label">finish</span
              ><span class="val">{detailMetric.finishReason ?? "—"}</span>
            </div>
            <div class="field">
              <span class="label">refused</span
              ><span class="val">{detailMetric.refused ? "Yes" : "No"}</span>
            </div>
            <div class="field">
              <span class="label">tool err</span
              ><span class="val"
                >{detailMetric.toolCallFailed ? "Yes" : "No"}</span
              >
            </div>
            <div class="field">
              <span class="label">source</span
              ><span class="val">{detailMetric.source}</span>
            </div>
            {#if detailMetric.errorBody}
              <div class="field full">
                <span class="label">error</span
                ><span class="val mono">{detailMetric.errorBody}</span>
              </div>
            {/if}
          </div>
          {#if detailChain.length > 0}
            <div class="chain-title">
              Request Chain ({detailChain.length}
              attempts)
            </div>
            {#each detailChain as m, idx}
              <div class="chain-item">
                <span class="chain-num">attempt #{idx + 1}</span>
                <span class="chain-prov">{m.provider} ({m.model})</span>
                <span class="chain-status {m.success ? 'ok' : 'err'}"
                  >{m.statusCode ? String(m.statusCode) : "ERR"}
                  {m.errorType ? ` ${m.errorType}` : ""}</span
                >
                <span class="chain-ttft">{formatNumber(m.ttft, "ms")}</span>
              </div>
            {/each}
          {/if}
        {/if}
      </Dialog>
    {:else if currentHash === '#/playground'}
      <PlaygroundPage providers={dashboardSocket.availableProviders} />
    {:else if currentHash === '#/settings'}
      <Settings
        serverAddr={`${dashboardSocket.serverHost}:${dashboardSocket.serverPort}`}
        onOpenModelPriority={() => (modelPriorityOpen = true)}
      />
    {:else if flowRoute?.kind === "new-definition"}
      <DefinitionEditor isNew={true} />
    {:else if flowRoute?.kind === "definition"}
      <FlowDefinitionPage definitionId={flowRoute.flowName} />
    {:else if flowRoute?.kind === "edit-definition"}
      <DefinitionEditor isNew={false} definitionId={flowRoute.flowName} />
    {:else if flowRoute?.kind === "view-definition"}
      <FlowDefinitionView definitionId={flowRoute.flowName} />
    {:else if flowRoute?.kind === "new-instance"}
      <InstantiateForm definitionId={flowRoute.flowName} />
    {:else if flowRoute?.kind === "instance"}
      <FlowInstancePage
        definitionId={flowRoute.flowName}
        instanceName={flowRoute.instanceName}
      />
    {:else if flowRoute?.kind === "library"}
      <FlowLibrary />
    {:else}
      <Landing />
    {/if}
  </main>

  <BottomBar
    data={headerData ?? undefined}
    onOverrideSet={handleOverrideSet}
    onOverrideClear={handleOverrideClear}
    onOpenModelPriority={() => (modelPriorityOpen = true)}
  />
</div>

<ModelPriorityModal bind:open={modelPriorityOpen} />

<style>
.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}
.top-bar {
  flex-shrink: 0;
  z-index: 100;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.app-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: var(--text-xs);
  color: var(--muted);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.crumb-link {
  color: var(--muted);
  text-decoration: none;
}
.crumb-link:hover {
  color: var(--text);
}
.crumb-sep {
  opacity: 0.5;
}
.crumb-current {
  color: var(--text);
}
.dash {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  grid-template-areas:
    "strip strip"
    "board board"
    "sessions providers"
    "logs logs";
  gap: var(--space-4);
  max-width: 1400px;
  margin: 0 auto;
  padding: 1.25rem;
  align-items: start;
}
@media (max-width: 1100px) {
  .dash {
    grid-template-columns: 1fr;
    grid-template-areas:
      "strip"
      "board"
      "sessions"
      "providers"
      "logs";
  }
}
.dash-strip {
  grid-area: strip;
}
.dash-board {
  grid-area: board;
}
.dash-sessions {
  grid-area: sessions;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  align-content: start;
}
@media (max-width: 640px) {
  .dash-sessions {
    grid-template-columns: 1fr;
  }
}
.dash-providers {
  grid-area: providers;
  min-width: 0;
}
.dash-providers :global(.provider-panel) {
  max-height: min(620px, calc(100dvh - 320px));
  min-height: 260px;
}
.dash-providers :global(.panel-content) {
  max-height: calc(min(620px, 100dvh - 320px) - 41px);
}
.dash-logs {
  grid-area: logs;
}
.panel-head {
  margin-bottom: var(--space-2);
}
.panel-head h2 {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin: 0;
}
.board-scroll {
  max-height: 200px;
  overflow-y: auto;
}
.board-scroll :global(.pipeline) {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.dialog-title {
  margin: 0 0 0.75rem 0;
  font-size: 0.75rem;
  font-weight: 700;
}
.detail-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25rem 0.75rem;
  font-size: 0.75rem;
}
.field {
  display: contents;
}
.field.full {
  grid-column: 1 / -1;
}
.label {
  color: var(--muted);
}
.val {
  color: var(--text);
}
.val.mono {
  font-family: monospace;
  font-size: 0.625rem;
}
.val.ok {
  color: var(--success);
}
.val.err {
  color: var(--error);
}
.chain-title {
  margin-top: 1rem;
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--muted);
  border-top: 1px solid var(--border);
  padding-top: 0.75rem;
}
.chain-item {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.6875rem;
  padding: 0.25rem 0;
}
.chain-num {
  color: var(--text);
  font-weight: 700;
}
.chain-prov {
  font-family: monospace;
  font-size: 0.625rem;
}
.chain-status {
  font-weight: 700;
}
.chain-status.ok {
  color: var(--success);
}
.chain-status.err {
  color: var(--error);
}
.chain-ttft {
  color: var(--muted);
}
</style>
