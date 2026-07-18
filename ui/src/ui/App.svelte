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
} from "./types";
import "../app.css";
import Header from "./Header.svelte";
import Stats from "./Stats.svelte";
import ProviderPanel from "./ProviderPanel.svelte";
import Sessions from "./Sessions.svelte";
import OrchestratorPanel from "./OrchestratorPanel.svelte";
import BottomDrawer from "./BottomDrawer.svelte";
import LivePipeline from "./LivePipeline.svelte";
import Logs from "./Logs.svelte";
import DetailOverlay from "./DetailOverlay.svelte";
import { createSessionStore } from "./use-sessions.svelte";
import { createOrchestratorStore } from "./use-orchestrator.svelte";
import CanvasHost from "./canvas/CanvasHost.svelte";

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
  | { type: "session_init"; data: SessionState[] }
  | {
      type: "orchestrator_event";
      data: {
        sessionId: string;
        type: string;
        iteration?: number;
        finishReason?: string | null;
        toolCallCount?: number;
        toolName?: string;
        isError?: boolean;
        contentPreview?: string;
        error?: string;
      };
    }
  | {
      type: "orchestrator_complete";
      data: {
        sessionId: string;
        messages: {
          role: string;
          content: string;
          toolCalls?: unknown[];
          toolCallId?: string;
        }[];
        finish_reason: string;
        final_content: string;
        iterations: number;
        error?: string;
      };
    };

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
const orchestratorStore = createOrchestratorStore();
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
  if (msg.type === "orchestrator_event") {
    orchestratorStore.applyEvent(
      msg.data as Parameters<typeof orchestratorStore.applyEvent>[0]
    );
    return;
  }
  if (msg.type === "orchestrator_complete") {
    orchestratorStore.applyComplete(
      msg.data as Parameters<typeof orchestratorStore.applyComplete>[0]
    );
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

function handleOrchestrateStart(prompt: string) {
  const sessionId = orchestratorStore.start(prompt);
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "orchestrate_start",
        sessionId,
        messages: [{ role: "user", content: prompt }],
      })
    );
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
  <Header data={headerData ?? undefined} onOverrideSet={handleOverrideSet} onOverrideClear={handleOverrideClear} />
  
  {#if currentHash === '#/canvas'}
    <CanvasHost />
  {:else}
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
    <BottomDrawer bind:open={drawerOpen} title="Orchestrator">
      <OrchestratorPanel session={orchestratorStore.session} onStart={handleOrchestrateStart} />
    </BottomDrawer>
    <DetailOverlay {detailMetric} {detailAllMetrics} />
  {/if}
</div>

<style>
  .app { display: block; }
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
