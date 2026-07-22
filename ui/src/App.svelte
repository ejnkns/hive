<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { type LogEntry, logger } from "shared/logger";
import { getServerConfig } from "shared/server-config";
import type {
  AvailableProvider,
  ConversationData,
  FlowEvent,
  HeaderData,
  MetricData,
  OverrideState,
  ProviderData,
  SessionPatch,
  SessionState,
  SubScores,
} from "./shared/types";
import "./app.css";
import Header from "./shared/Header.svelte";
import Stats from "./dashboard/Stats.svelte";
import ProviderPanel from "./dashboard/ProviderPanel.svelte";
import Sessions from "./dashboard/Sessions.svelte";
import ProviderPlayground from "./dashboard/ProviderPlayground.svelte";
import BottomDrawer from "./shared/BottomDrawer.svelte";
import LivePipeline from "./dashboard/LivePipeline.svelte";
import Logs from "./dashboard/Logs.svelte";
import DetailOverlay from "./shared/DetailOverlay.svelte";
import { createSessionStore } from "./shared/use-sessions.svelte";
import CanvasHost from "./canvas/CanvasHost.svelte";
import ProjectOverview from "./queen-bee/project-overview.svelte";
import ProjectPage from "./queen-bee/project-page.svelte";
import ProjectIntegration from "./queen-bee/project-integration.svelte";
import {
  projectHeader,
  togglePanel,
} from "./queen-bee/project-header-state.svelte";

type ProviderPayload = {
  name: string;
  displayName: string;
  model: string;
  keyConfigured: boolean;
  stabilityScore: number;
  subscores: SubScores;
  p95Latency: number | null;
  meanTokensPerSecond: number | null;
  requestCount: number;
  recentSuccessRate: number;
  truncationRate: number;
  refusalRate: number;
  contentFilterRate: number;
  trippedUntil: number | null;
  disabledFeatures: string[];
  disabled: boolean;
};

type TelemetryData = {
  providers: ProviderPayload[];
  serverHost: string;
  serverPort: string;
  lastProvider: string | null;
  lastModel: string | null;
  overrideActive: boolean;
  overrideProvider: string | null;
  overrideModel: string | null;
  availableProviders: AvailableProvider[];
  metrics: MetricData[];
  pending: number;
  conversations: ConversationData[];
  bestProvider: string | null;
  bestModel: string | null;
  bestScore: number | null;
  routingStrategy: string;
  contextWindowWeight: number;
};

type WsMessage =
  | { type: "init" | "update"; data: TelemetryData }
  | { type: "log"; data: LogEntry }
  | { type: "flow"; data: FlowEvent }
  | { type: "session_state"; data: SessionPatch }
  | { type: "session_init"; data: SessionState[] };

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

let override: OverrideState = $state({
  active: false,
  provider: null,
  model: null,
});
let flowEvents: FlowEvent[] = $state([]);
let logEntries: LogEntry[] = $state([]);
let metrics: MetricData[] = $state([]);
let conversations: ConversationData[] = $state([]);

let telemetry: TelemetryData | null = $state(null);

let detailMetric: MetricData | null = $state(null);
let detailAllMetrics: MetricData[] = $state([]);

const sessionStore = createSessionStore();
let drawerOpen = $state(false);

let currentHash = $state(window.location.hash);
onMount(() => {
  const onHashChange = () => {
    currentHash = window.location.hash;
  };
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
});

let headerData = $derived.by(() => {
  const t = telemetry;
  if (!t) return null as HeaderData | null;
  const sorted = t.providers
    .filter((p) => p.keyConfigured)
    .sort((a, b) => b.stabilityScore - a.stabilityScore);
  const bestEntry = sorted[0] ?? null;
  const total = t.metrics.length;
  const okCount = t.metrics.filter((r) => r.success).length;
  const rate = total > 0 ? Math.round((okCount / total) * 100) : null;
  const names = new Set(
    t.providers.filter((x) => x.keyConfigured).map((x) => x.name)
  );
  const flights = t.metrics.filter((r) => r.success).map((r) => r.ttft);
  const avg =
    flights.length > 0
      ? Math.round(flights.reduce((a, b) => a + b, 0) / flights.length)
      : null;
  return {
    online: true,
    serverAddr: `${t.serverHost}:${t.serverPort}`,
    lastProvider: t.lastProvider,
    lastModel: t.lastModel,
    override,
    availableProviders: t.availableProviders,
    bestProvider: bestEntry?.name ?? null,
    bestModel: bestEntry?.model ?? null,
    bestScore: bestEntry?.stabilityScore ?? null,
    routingStrategy: t.routingStrategy,
    contextWindowWeight: t.contextWindowWeight,
    traffic: total,
    successRate: rate,
    activeProviders: names.size,
    avgLatency: avg,
  };
});

let statsData = $derived.by(() => {
  const t = telemetry;
  if (!t) return null;
  const okCount = t.metrics.filter((r) => r.success).length;
  const rate =
    t.metrics.length > 0
      ? Math.round((okCount / t.metrics.length) * 100)
      : null;
  const flights = t.metrics.filter((r) => r.success).map((r) => r.ttft);
  const avg =
    flights.length > 0
      ? Math.round(flights.reduce((a, b) => a + b, 0) / flights.length)
      : null;
  const names = new Set(
    t.providers.filter((x) => x.keyConfigured).map((x) => x.name)
  );
  return {
    traffic: t.metrics.length,
    successRate: rate,
    providers: names.size,
    avgLatency: avg,
  };
});

let providersData = $derived.by(() => {
  const t = telemetry;
  if (!t) return [] as ProviderData[];
  return t.providers.map((x) => ({
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
  override.active && override.provider && override.model
    ? `${override.provider}:${override.model}`
    : null
);

function connect() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
  const cfg = getServerConfig();
  const url = `${protocol}//${cfg.host}:${String(cfg.port)}/ws`;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    logger.error("websocket error", e);
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    reconnectDelay = 1000;
  };
  ws.onmessage = (e: MessageEvent) => {
    try {
      const msg = JSON.parse(String(e.data)) as WsMessage;
      handleMessage(msg);
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    connect();
  }, reconnectDelay);
}

function closeWs() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}

function handleMessage(msg: WsMessage) {
  if (msg.type === "flow") {
    flowEvents.push(msg.data);
    if (flowEvents.length > 100) flowEvents.shift();
    return;
  }
  if (msg.type === "log") {
    logEntries.push(msg.data);
    if (logEntries.length > 500) logEntries.shift();
    return;
  }
  if (msg.type === "session_state") {
    sessionStore.applyPatch(msg.data);
    return;
  }
  if (msg.type === "session_init") {
    sessionStore.initSessions(msg.data);
    return;
  }
  telemetry = msg.data;
  override = {
    active: msg.data.overrideActive,
    provider: msg.data.overrideProvider,
    model: msg.data.overrideModel,
  };
  metrics = msg.data.metrics;
  conversations = msg.data.conversations;
}

function handleMetricClick(metric: MetricData, allMetrics: MetricData[]) {
  detailMetric = metric;
  detailAllMetrics = allMetrics;
}

function handleOverrideSet(provider: string, model: string) {
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(
      JSON.stringify({ type: "override", provider, model, enabled: true })
    );
}

function handleOverrideClear() {
  if (
    ws?.readyState === WebSocket.OPEN &&
    override.provider &&
    override.model
  ) {
    ws.send(
      JSON.stringify({
        type: "override",
        provider: override.provider,
        model: override.model,
        enabled: false,
      })
    );
  }
}

function handleToggleProvider(provider: string, disabled: boolean) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "toggle_provider", provider, disabled }));
  }
}

onMount(() => {
  connect();
});

onDestroy(() => {
  closeWs();
});
</script>

<div class="app">
  <div class="top-bar">
    <Header data={headerData ?? undefined} onOverrideSet={handleOverrideSet} onOverrideClear={handleOverrideClear} />
    {#if currentHash.startsWith('#/project/') && projectHeader.projectId}
      <div class="project-header">
        <div class="project-header-row">
          <a href="#/" class="back-link">&larr; Projects</a>
          <div class="header-right">
            {#key projectHeader.projectId}
              <ProjectIntegration projectId={projectHeader.projectId} />
            {/key}
            {#if projectHeader.requirementsContent}
              <button class="btn btn-outline" onclick={togglePanel}>
                {projectHeader.panelOpen ? "Hide" : "View"} Requirements
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
        <Sessions sessions={sessionStore.sessions} />
        <ProviderPanel data={providersData} {metrics} {conversations} overrideKey={overrideKey} onRowClick={handleMetricClick} onToggleProvider={handleToggleProvider} lastProvider={headerData?.lastProvider ?? null} lastModel={headerData?.lastModel ?? null} />
      </div>
      <div class="section-head" style="margin-top:1.5rem">Pipeline</div>
      <LivePipeline events={flowEvents} providers={providersData} />
      <Logs entries={logEntries} />
    </div>
    <BottomDrawer bind:open={drawerOpen} title="Provider playground">
      <ProviderPlayground providers={telemetry?.availableProviders ?? []} />
    </BottomDrawer>
    <DetailOverlay {detailMetric} {detailAllMetrics} />
  {:else if currentHash.startsWith('#/project/')}
    <ProjectPage projectId={currentHash.slice('#/project/'.length)} />
  {:else}
    <ProjectOverview />
  {/if}
</div>

<style>
  .app { display: block; }
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
