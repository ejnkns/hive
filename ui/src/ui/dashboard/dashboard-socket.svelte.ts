import type {
  AvailableProvider,
  FlowEvent,
  MetricData,
  OverrideState,
  PipelineStateMessage,
  ProviderPayload,
  SessionSnapshot,
  WsServerMessage,
} from "shared/dashboard-types";
import { type LogEntry, logger } from "shared/logger";
import { getServerConfig } from "shared/server-config";
import { createSessionStore } from "../use-sessions.svelte";

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1_000;

let connected = $state(false);
let override = $state<OverrideState>({
  active: false,
  provider: null,
  model: null,
});
let providers = $state<ProviderPayload[]>([]);
let availableProviders = $state<AvailableProvider[]>([]);
let metrics = $state<MetricData[]>([]);
let flowEvents = $state<(FlowEvent | PipelineStateMessage)[]>([]);
let logEntries = $state<LogEntry[]>([]);
let serverHost = $state("");
let serverPort = $state("");
let routingStrategy = $state("");
let contextWindowWeight = $state(0);
let pendingCount = $state(0);

const sessionStore = createSessionStore();

function scheduleReconnect() {
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  reconnectTimer = setTimeout(() => {
    connect();
  }, reconnectDelay);
}

function connect() {
  closeSocket();
  reconnectDelay = 1_000;

  const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
  const cfg = getServerConfig();
  const url = `${protocol}//${cfg.host}:${String(cfg.port)}/ws`;

  try {
    socket = new WebSocket(url);
  } catch (e) {
    logger.error("dashboard websocket error", e);
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    connected = true;
  };

  socket.onmessage = (e: MessageEvent) => {
    try {
      const msg = JSON.parse(String(e.data)) as WsServerMessage;
      handleMessage(msg);
    } catch {
      // ignore malformed frames
    }
  };

  socket.onclose = () => {
    connected = false;
    socket = null;
    scheduleReconnect();
  };
}

function handleMessage(msg: WsServerMessage) {
  if (msg.type === "session_snapshot") {
    sessionStore.replaceAll(msg.sessions);
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
  if (msg.type === "session_detail") {
    return;
  }
  if (msg.type === "pipeline_state") {
    flowEvents.push(msg);
    if (flowEvents.length > 100) flowEvents.shift();
    return;
  }
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
  if (msg.type === "override_update") {
    override = msg.override;
    return;
  }
  if (msg.type === "provider_update") {
    providers = msg.providers;
    return;
  }
  if (msg.type === "metrics_update") {
    metrics = msg.metrics;
    return;
  }
  if (msg.type === "available_providers_update") {
    availableProviders = msg.availableProviders;
    return;
  }
  // New init format (check first — discriminated by "sessions" vs "data")
  if (msg.type === "init" && "sessions" in msg) {
    const m = msg as unknown as {
      providers: ProviderPayload[];
      availableProviders: AvailableProvider[];
      metrics: MetricData[];
      override: OverrideState;
      sessions: SessionSnapshot;
      serverHost: string;
      serverPort: string;
      routingStrategy: string;
      contextWindowWeight: number;
      pending: number;
    };
    providers = m.providers;
    availableProviders = m.availableProviders;
    metrics = m.metrics;
    override = m.override;
    serverHost = m.serverHost;
    serverPort = m.serverPort;
    routingStrategy = m.routingStrategy;
    contextWindowWeight = m.contextWindowWeight;
    pendingCount = m.pending;
    sessionStore.replaceAll(m.sessions);
    return;
  }
  // Legacy init/update with data wrapper
  if ("data" in msg) {
    const d = msg.data;
    providers = d.providers;
    availableProviders = d.availableProviders;
    metrics = d.metrics;
    override = {
      active: d.overrideActive,
      provider: d.overrideProvider,
      model: d.overrideModel,
    };
    serverHost = d.serverHost;
    serverPort = d.serverPort;
    routingStrategy = d.routingStrategy;
    contextWindowWeight = d.contextWindowWeight;
    pendingCount = d.pending;
  }
}

function closeSocket() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
  connected = false;
}

function send(msg: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export function setOverride(provider: string, model: string) {
  send({ type: "override", provider, model, enabled: true });
}

export function clearOverride(provider: string, model: string) {
  send({ type: "override", provider, model, enabled: false });
}

export function toggleProvider(provider: string, disabled: boolean) {
  send({ type: "toggle_provider", provider, disabled });
}

export function requestSessionDetail(sessionId: string, requestId: string) {
  send({ type: "session_detail", sessionId, requestId });
}

export const dashboardSocket = {
  connect,
  get connected() {
    return connected;
  },
  get override() {
    return override;
  },
  get providers() {
    return providers;
  },
  get availableProviders() {
    return availableProviders;
  },
  get metrics() {
    return metrics;
  },
  get flowEvents() {
    return flowEvents;
  },
  get logEntries() {
    return logEntries;
  },
  get serverHost() {
    return serverHost;
  },
  get serverPort() {
    return serverPort;
  },
  get routingStrategy() {
    return routingStrategy;
  },
  get contextWindowWeight() {
    return contextWindowWeight;
  },
  get pendingCount() {
    return pendingCount;
  },
  get sessions() {
    return sessionStore.sessions;
  },
  setOverride,
  clearOverride,
  toggleProvider,
  requestSessionDetail,
  disconnect: closeSocket,
};
