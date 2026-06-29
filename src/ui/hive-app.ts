import { type LogEntry, logger } from "../shared/logger";
import type { AvailableProvider, ConversationData, MetricData, OverrideState, ProviderData } from "./types";
import "./hive-header";
import "./hive-stats";
import "./hive-providers";
import "./hive-detail-overlay";
import "./hive-logs";
import { getServerConfig } from "../shared/server-config";

type WebSocketType = typeof WebSocket.prototype;

// ─── Shared payload types (mirror server-side shape) ───────────────────────

type ProviderPayload = {
  name: string;
  displayName: string;
  model: string;
  keyConfigured: boolean;
  stabilityScore: number;
  p95Latency: number | null;
  meanTokensPerSecond: number | null;
  requestCount: number;
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
};

type WsMessage = { type: "init" | "update"; data: TelemetryData } | { type: "log"; data: LogEntry };

// ─── Element type helpers ───────────────────────────────────────────────────

type HeaderEl = HTMLElement & {
  data: {
    online: boolean;
    serverAddr: string;
    lastProvider: string | null;
    lastModel: string | null;
    override: OverrideState;
    availableProviders: AvailableProvider[];
    bestProvider: string | null;
    bestModel: string | null;
    bestScore: number | null;
  };
};
type StatsEl = HTMLElement & {
  data: {
    traffic: number;
    successRate: number;
    providers: number;
    avgLatency: number | null;
  };
};
type ProvidersEl = HTMLElement & {
  data: ProviderData[];
  metrics: MetricData[];
  conversations: ConversationData[];
  overrideKey: string | null;
};
type LogsEl = HTMLElement & { addLog(log: LogEntry): void };
type DetailOverlayEl = HTMLElement & {
  show(metric: MetricData, allMetrics: MetricData[]): void;
};

// ─── Component ─────────────────────────────────────────────────────────────

export class HiveApp extends HTMLElement {
  private shadow: ShadowRoot;
  private ws: WebSocketType | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000; // start at 1s, backs off to 30s
  private lastMetrics: MetricData[] = [];
  private _override: OverrideState = {
    active: false,
    provider: null,
    model: null,
  };
  private _availableProviders: AvailableProvider[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadow.innerHTML = `
      <style>
        :host { display: block; }
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
      <hive-header></hive-header>
      <div class="content">
        <hive-stats></hive-stats>
        <div>
          <div class="section-head">Providers</div>
          <hive-providers></hive-providers>
        </div>
        <hive-logs></hive-logs>
      </div>
      <hive-detail-overlay></hive-detail-overlay>
    `;

    this.addEventListener("row-click", (e) => {
      const { metric, allMetrics } = (
        e as unknown as CustomEvent<{
          metric: MetricData;
          allMetrics: MetricData[];
        }>
      ).detail;
      const overlay = this.shadow.querySelector("hive-detail-overlay") as DetailOverlayEl | null;
      overlay?.show(metric, allMetrics);
    });

    this.addEventListener("override-set", ((e: CustomEvent<{ provider: string; model: string }>) => {
      this.setOverride(e.detail.provider, e.detail.model);
    }) as EventListener);

    this.addEventListener("override-clear", () => {
      this.clearOverride();
    });

    this.connect();
  }

  disconnectedCallback() {
    this.close();
  }

  // ── WebSocket lifecycle ─────────────────────────────────────────────────

  private connect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
    const cfg = getServerConfig();
    const url = `${protocol}//${cfg.host}:${String(cfg.port)}/ws`;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      logger.error(`Couldn't create a new WebSocket on the client. URL: ${url}`, e);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data)) as WsMessage;
        this.handleMessage(msg);
      } catch {
        // ignore malformed frames
      }
    };

    this.ws.onclose = () => {
      this.setOnline(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose fires after onerror — let that handler schedule reconnect
    };
  }

  private close() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      this.connect();
    }, this.reconnectDelay);
  }

  // ── Message dispatch ────────────────────────────────────────────────────

  private handleMessage(msg: WsMessage) {
    if (msg.type === "log") {
      const logsEl = this.shadow.querySelector("hive-logs") as LogsEl | null;
      logsEl?.addLog(msg.data);
      return;
    }

    // "init" or "update"
    this.applyTelemetry(msg.data);
  }

  private applyTelemetry(data: TelemetryData) {
    this._override = {
      active: data.overrideActive,
      provider: data.overrideProvider,
      model: data.overrideModel,
    };
    this._availableProviders = data.availableProviders;

    const bestEntry =
      data.providers.filter((p) => p.keyConfigured).sort((a, b) => b.stabilityScore - a.stabilityScore)[0] ?? null;

    let bestProvider: string | null = null;
    let bestModel: string | null = null;
    let bestScore: number | null = null;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (bestEntry) {
      bestProvider = bestEntry.name;
      bestModel = bestEntry.model;
      bestScore = bestEntry.stabilityScore;
    }

    this.setOnline(
      true,
      data.serverHost,
      data.serverPort,
      data.lastProvider,
      data.lastModel,
      this._override,
      this._availableProviders,
      bestProvider,
      bestModel,
      bestScore
    );

    this.lastMetrics = data.metrics;

    const total = data.metrics.length;
    const okCount = data.metrics.filter((r) => r.success).length;
    const rate = total > 0 ? Math.round((okCount / total) * 100) : 100;
    const configuredNames = new Set(data.providers.filter((x) => x.keyConfigured).map((x) => x.name));
    const providersCount = configuredNames.size;
    const flights = data.metrics.filter((r) => r.success).map((r) => r.ttft);
    const avgFlight = flights.length > 0 ? Math.round(flights.reduce((a, b) => a + b, 0) / flights.length) : null;

    const statsElement = this.shadow.querySelector("hive-stats") as unknown as StatsEl | null;
    if (statsElement) {
      statsElement.data = {
        traffic: total,
        successRate: rate,
        providers: providersCount,
        avgLatency: avgFlight,
      };
    }

    const providers: ProviderData[] = data.providers.map((x) => ({
      name: x.name,
      displayName: x.displayName,
      model: x.model,
      keyConfigured: x.keyConfigured,
      stabilityScore: x.stabilityScore,
      p95Latency: x.p95Latency,
      meanTokensPerSecond: x.meanTokensPerSecond,
      requestCount: x.requestCount,
      trippedUntil: x.trippedUntil,
      disabledFeatures: x.disabledFeatures,
    }));

    const providersElement = this.shadow.querySelector("hive-providers") as unknown as ProvidersEl | null;
    if (providersElement) {
      providersElement.metrics = data.metrics;
      providersElement.conversations = data.conversations;
      providersElement.data = providers;
      providersElement.overrideKey =
        this._override.active && this._override.provider && this._override.model
          ? `${this._override.provider}:${this._override.model}`
          : null;
    }
  }

  private setOnline(
    online: boolean,
    host = "—",
    port = "",
    lastProvider: string | null = null,
    lastModel: string | null = null,
    override: OverrideState = { active: false, provider: null, model: null },
    availableProviders: AvailableProvider[] = [],
    bestProvider: string | null = null,
    bestModel: string | null = null,
    bestScore: number | null = null
  ) {
    const header = this.shadow.querySelector("hive-header") as unknown as HeaderEl | null;
    if (header) {
      header.data = {
        online,
        serverAddr: online ? `${host}:${port}` : "—",
        lastProvider,
        lastModel,
        override,
        availableProviders,
        bestProvider,
        bestModel,
        bestScore,
      };
    }
  }

  // ── Override commands ────────────────────────────────────────────────────

  setOverride(provider: string, model: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "override", provider, model }));
    }
  }

  clearOverride(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "override", provider: null, model: null }));
    }
  }
}

customElements.define("hive-app", HiveApp);
