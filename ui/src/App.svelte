<script lang="ts">
import type { MetricData, ProviderPayload } from "shared/dashboard-types";
import { onMount } from "svelte";
import { dashboardSocket } from "./dashboard/dashboard-socket.svelte";
import type { HeaderData } from "./shared/utils";
import { formatNumber, formatTime } from "./shared/utils";
import "./app.css";
import CanvasHost from "./canvas/CanvasHost.svelte";
import LivePipeline from "./dashboard/LivePipeline.svelte";
import Logs from "./dashboard/Logs.svelte";
import ModelPriorityModal from "./dashboard/ModelPriorityModal.svelte";
import ProviderPanel from "./dashboard/ProviderPanel.svelte";
import ProviderPlayground from "./dashboard/ProviderPlayground.svelte";
import Sessions from "./dashboard/Sessions.svelte";
import Stats from "./dashboard/Stats.svelte";
import Header from "./shared/Header.svelte";
import Button from "./shared/ui/Button.svelte";
import Dialog from "./shared/ui/Dialog.svelte";
import DefinitionEditor from "./workflow/DefinitionEditor.svelte";
import FlowDefinitionPage from "./workflow/FlowDefinitionPage.svelte";
import FlowInstancePage from "./workflow/FlowInstancePage.svelte";
import FlowLibrary from "./workflow/FlowLibrary.svelte";
import InstantiateForm from "./workflow/InstantiateForm.svelte";

let detailMetric: MetricData | null = $state(null);
let detailAllMetrics: MetricData[] = $state([]);
let drawerOpen = $state(false);
let modelPriorityModalOpen = $state(false);

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

type FlowRoute =
  | { kind: "library" }
  | { kind: "new-definition" }
  | { kind: "definition"; flowName: string }
  | { kind: "edit-definition"; flowName: string }
  | { kind: "new-instance"; flowName: string }
  | { kind: "instance"; flowName: string; instanceName: string };

function parseFlowRoute(hash: string): FlowRoute | null {
  if (hash === "#/flows" || hash === "" || hash === "#") {
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
  if (rest === "new") return { kind: "new-instance", flowName };
  return { kind: "instance", flowName, instanceName: decodeURIComponent(rest) };
}

const flowRoute = $derived(parseFlowRoute(currentHash));

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
    <Header
      data={headerData ?? undefined}
      onOverrideSet={handleOverrideSet}
      onOverrideClear={handleOverrideClear}
      onOpenModelPriority={() => (modelPriorityModalOpen = true)}
    />
    {#if flowRoute && flowRoute.kind !== "library"}
      <div class="project-header">
        <div class="project-header-row">
          <a href="#/flows" class="back-link">&larr; Flows</a>
          {#if flowRoute.kind === "definition" || flowRoute.kind === "edit-definition" || flowRoute.kind === "new-instance" || flowRoute.kind === "instance"}
            <span class="project-id">{flowRoute.flowName}</span>
          {/if}
        </div>
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
    <div class="drawer-trigger">
      <Button variant="azure" onclick={() => drawerOpen = true}>
        Playground
      </Button>
    </div>
    <Dialog
      bind:open={drawerOpen}
      label="Provider playground"
      contentMaxWidth="700px"
    >
      <h3 class="drawer-title">Provider playground</h3>
      <ProviderPlayground providers={dashboardSocket.availableProviders} />
    </Dialog>
    <Dialog
      open={detailOpen}
      onOpenChange={(v) => { if (!v) detailMetric = null }}
      label="Request Detail"
    >
      <h2 class="dialog-title">Request Detail</h2>
      {#if detailMetric}
        <div class="detail-grid">
          <div class="field">
            <span class="label">Request ID</span
            ><span class="val mono">{detailMetric.requestId}</span>
          </div>
          <div class="field">
            <span class="label">Provider</span
            ><span class="val">{detailMetric.provider}</span>
          </div>
          <div class="field">
            <span class="label">Model</span
            ><span class="val mono">{detailMetric.model}</span>
          </div>
          <div class="field">
            <span class="label">Time</span
            ><span class="val">{formatTime(detailMetric.timestamp)}</span>
          </div>
          <div class="field">
            <span class="label">TTFT</span
            ><span class="val">{formatNumber(detailMetric.ttft, "ms")}</span>
          </div>
          <div class="field">
            <span class="label">Total</span
            ><span class="val"
              >{formatNumber(detailMetric.totalLatency, "ms")}</span
            >
          </div>
          <div class="field">
            <span class="label">Tokens I/O</span
            ><span class="val"
              >{detailMetric.inputTokens ?? "—"}
              / {detailMetric.outputTokens ?? "—"}</span
            >
          </div>
          <div class="field">
            <span class="label">Thinking</span
            ><span class="val"
              >{detailMetric.thinkingTime != null ? `${detailMetric.thinkingTime}ms` : "—"}</span
            >
          </div>
          <div class="field">
            <span class="label">Status</span
            ><span class="val {detailMetric.success ? 'ok' : 'err'}"
              >{String(detailMetric.statusCode)}</span
            >
          </div>
          <div class="field">
            <span class="label">Finish</span
            ><span class="val">{detailMetric.finishReason ?? "—"}</span>
          </div>
          <div class="field">
            <span class="label">Refused</span
            ><span class="val">{detailMetric.refused ? "Yes" : "No"}</span>
          </div>
          <div class="field">
            <span class="label">Tool Err</span
            ><span class="val"
              >{detailMetric.toolCallFailed ? "Yes" : "No"}</span
            >
          </div>
          <div class="field">
            <span class="label">Source</span
            ><span class="val">{detailMetric.source}</span>
          </div>
          {#if detailMetric.errorBody}
            <div class="field full">
              <span class="label">Error</span
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
              <span class="chain-num">Attempt #{idx + 1}</span>
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
    <ModelPriorityModal bind:open={modelPriorityModalOpen} />
  {:else if flowRoute?.kind === "new-definition"}
    <DefinitionEditor isNew={true} />
  {:else if flowRoute?.kind === "definition"}
    <FlowDefinitionPage definitionId={flowRoute.flowName} />
  {:else if flowRoute?.kind === "edit-definition"}
    <DefinitionEditor isNew={false} definitionId={flowRoute.flowName} />
  {:else if flowRoute?.kind === "new-instance"}
    <InstantiateForm definitionId={flowRoute.flowName} />
  {:else if flowRoute?.kind === "instance"}
    <FlowInstancePage
      definitionId={flowRoute.flowName}
      instanceName={flowRoute.instanceName}
    />
  {:else}
    <FlowLibrary />
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
.project-id {
  font-size: 0.75rem;
  color: var(--muted);
  font-family: var(--font-mono, monospace);
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
  margin-top: 1.5rem;
}
.drawer-trigger {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: 40;
}
.dialog-title {
  margin: 0 0 0.75rem 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}
.drawer-title {
  margin: 0 0 1rem 0;
  font-size: 0.875rem;
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
  text-transform: uppercase;
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
  color: var(--accent);
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
