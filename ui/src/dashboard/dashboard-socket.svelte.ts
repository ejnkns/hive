import type {
  AvailableProvider,
  InitMessage,
  MetricData,
  ModelPriority,
  OverrideState,
  PipelineStateMessage,
  ProviderPayload,
  WsServerMessage,
} from "shared/dashboard-types";
import { type LogEntry, logger } from "shared/logger";
import { getServerConfig } from "shared/server-config";
import { createSessionStore } from "../shared/use-sessions.svelte";

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
let flowEvents = $state<PipelineStateMessage[]>([]);
let logEntries = $state<LogEntry[]>([]);
let serverHost = $state("");
let serverPort = $state("");
let routingStrategy = $state("");
let contextWindowWeight = $state(0);
let pendingCount = $state(0);
let modelPriorityConfig = $state<ModelPriority | null>(null);

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
  if (msg.type === "pipeline_state") {
    flowEvents.push(msg);
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
  if (msg.type === "model_priority_update") {
    modelPriorityConfig = msg.config;
    return;
  }
  if (msg.type === "init") {
    applyInit(msg);
  }
}

function applyInit(msg: InitMessage) {
  providers = msg.providers;
  availableProviders = msg.availableProviders;
  metrics = msg.metrics;
  override = msg.override;
  serverHost = msg.serverHost;
  serverPort = msg.serverPort;
  routingStrategy = msg.routingStrategy;
  contextWindowWeight = msg.contextWindowWeight;
  pendingCount = msg.pending;
  modelPriorityConfig = msg.modelPriorityConfig;
  sessionStore.replaceAll(msg.sessions);
  logEntries = msg.logs;
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

export function updateModelPriority(config: ModelPriority) {
  send({ type: "update_model_priority", config });
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
  get modelPriorityConfig() {
    return modelPriorityConfig;
  },
  get sessions() {
    return sessionStore.sessions;
  },
  setOverride,
  clearOverride,
  toggleProvider,
  updateModelPriority,
  disconnect: closeSocket,
};
