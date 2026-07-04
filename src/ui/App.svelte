<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { type LogEntry, logger } from "../shared/logger";
import { getServerConfig } from "../shared/server-config";
import type {
  AvailableProvider,
  ConversationData,
  FlowEvent,
  HeaderData,
  MetricData,
  OverrideState,
  ProviderData,
  SubScores,
} from "./types";
import "../app.css";
import Header from "./Header.svelte";
import Stats from "./Stats.svelte";
import Providers from "./Providers.svelte";
import Flow from "./Flow.svelte";
import Logs from "./Logs.svelte";
import DetailOverlay from "./DetailOverlay.svelte";

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
  | { type: "flow"; data: FlowEvent };

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

let headerData = $derived.by(() => {
  const t = telemetry;
  if (!t) return null as HeaderData | null;
  const sorted = t.providers
    .filter((p) => p.keyConfigured)
    .sort((a, b) => b.stabilityScore - a.stabilityScore);
  const bestEntry = sorted[0] ?? null;
  const total = t.metrics.length;
  const okCount = t.metrics.filter((r) => r.success).length;
  const rate = total > 0 ? Math.round((okCount / total) * 100) : 100;
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
    t.metrics.length > 0 ? Math.round((okCount / t.metrics.length) * 100) : 100;
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

onMount(() => {
  connect();
});

onDestroy(() => {
  closeWs();
});
</script>

<div class="app">
  <Header data={headerData ?? undefined} onOverrideSet={handleOverrideSet} onOverrideClear={handleOverrideClear} />
  <div class="content">
    <Stats data={statsData} />
    <div>
      <div class="section-head">Providers</div>
      <Providers data={providersData} {metrics} {conversations} overrideKey={overrideKey} onRowClick={handleMetricClick} />
      <div class="section-head" style="margin-top:1.5rem">Live Requests</div>
      <Flow events={flowEvents} />
    </div>
    <Logs entries={logEntries} />
  </div>
  <DetailOverlay {detailMetric} {detailAllMetrics} />
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
