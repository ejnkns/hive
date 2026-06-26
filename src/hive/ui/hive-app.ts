import type { ProviderData, MetricData, ConversationData } from "./types";
import "./hive-header";
import "./hive-stats";
import "./hive-swarm";
import "./hive-providers";
import "./hive-activity-tabs";
import "./hive-detail-overlay";

const POLL_MS = 5000;

type ProvidersResponse = {
  serverHost: string;
  serverPort: string;
  lastProvider: string | null;
  lastModel: string | null;
  providers?: Array<{
    name: string;
    model: string;
    keyConfigured: boolean;
    stabilityScore: number;
    p95Latency: number | null;
    meanTokensPerSecond: number | null;
    requestCount: number;
  }>;
};

type MetricsResponse = {
  metrics?: MetricData[];
};

type ConversationsResponse = {
  conversations?: ConversationData[];
};

type HeaderEl = HTMLElement & {
  data: {
    online: boolean;
    serverAddr: string;
    lastProvider: string | null;
    lastModel: string | null;
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
type SwarmEl = HTMLElement & { data: ProviderData[] };
type ProvidersEl = HTMLElement & { data: ProviderData[] };
type TabsEl = HTMLElement & {
  data: { metrics: MetricData[]; conversations: ConversationData[] };
};
type DetailOverlayEl = HTMLElement & {
  show(metric: MetricData, allMetrics: MetricData[]): void;
};

export class HiveApp extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
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
      <hive-header></hive-header>
      <div class="content">
        <hive-stats></hive-stats>
        <hive-swarm></hive-swarm>
        <div>
          <div class="section-head">Providers</div>
          <hive-providers></hive-providers>
        </div>
        <hive-activity-tabs></hive-activity-tabs>
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
      const overlay = this.shadow.querySelector(
        "hive-detail-overlay"
      ) as unknown as DetailOverlayEl | null;
      overlay?.show(metric, allMetrics);
    });

    void this.tick();
    setInterval(() => {
      void this.tick();
    }, POLL_MS);
  }

  private async tick() {
    try {
      const [pr, mr, cr] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/metrics"),
        fetch("/api/conversations"),
      ]);
      if (!pr.ok || !mr.ok || !cr.ok) throw new Error("fetch failed");

      const p = (await pr.json()) as ProvidersResponse;
      const m = (await mr.json()) as MetricsResponse;
      const c = (await cr.json()) as ConversationsResponse;

      const header = this.shadow.querySelector(
        "hive-header"
      ) as unknown as HeaderEl | null;
      if (header) {
        header.data = {
          online: true,
          serverAddr: p.serverHost + ":" + p.serverPort,
          lastProvider: p.lastProvider ?? null,
          lastModel: p.lastModel ?? null,
        };
      }

      const metrics: MetricData[] = m.metrics ?? [];
      const conversations: ConversationData[] = c.conversations ?? [];

      const total = metrics.length;
      const okCount = metrics.filter((r) => r.success).length;
      const rate = total > 0 ? Math.round((okCount / total) * 100) : 100;
      const providersList = p.providers ?? [];
      const providersCount = new Set(
        providersList.filter((x) => x.keyConfigured).map((x) => x.name)
      ).size;
      const flights = metrics.filter((r) => r.success).map((r) => r.ttft);
      const avgFlight =
        flights.length > 0
          ? Math.round(flights.reduce((a, b) => a + b, 0) / flights.length)
          : null;

      const stats = this.shadow.querySelector(
        "hive-stats"
      ) as unknown as StatsEl | null;
      if (stats) {
        stats.data = {
          traffic: total,
          successRate: rate,
          providers: providersCount,
          avgLatency: avgFlight,
        };
      }

      const providers: ProviderData[] = (p.providers ?? []).map((x) => ({
        name: x.name,
        model: x.model,
        keyConfigured: x.keyConfigured,
        stabilityScore: x.stabilityScore,
        p95Latency: x.p95Latency,
        meanTokensPerSecond: x.meanTokensPerSecond,
        requestCount: x.requestCount,
      }));

      const swarm = this.shadow.querySelector(
        "hive-swarm"
      ) as unknown as SwarmEl | null;
      if (swarm) swarm.data = providers;

      const providersEl = this.shadow.querySelector(
        "hive-providers"
      ) as unknown as ProvidersEl | null;
      if (providersEl) providersEl.data = providers;

      const tabs = this.shadow.querySelector(
        "hive-activity-tabs"
      ) as unknown as TabsEl | null;
      if (tabs) tabs.data = { metrics, conversations };
    } catch {
      const header = this.shadow.querySelector(
        "hive-header"
      ) as unknown as HeaderEl | null;
      if (header) {
        header.data = {
          online: false,
          serverAddr: "—",
          lastProvider: null,
          lastModel: null,
        };
      }
    }
  }
}

customElements.define("hive-app", HiveApp);
