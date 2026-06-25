import type {
  ProviderData,
  MetricData,
  ConversationData,
  StatsData,
  HeaderData,
} from "./types";
import "./hive-header";
import "./hive-stats";
import "./hive-swarm";
import "./hive-providers";
import "./hive-activity-tabs";
import "./hive-detail-overlay";

const POLL_MS = 3000;

interface HeaderEl extends HTMLElement {
  data: HeaderData;
}
interface StatsEl extends HTMLElement {
  data: StatsData | null;
}
interface SwarmEl extends HTMLElement {
  data: ProviderData[];
}
interface ProvidersEl extends HTMLElement {
  data: ProviderData[];
}
interface TabsEl extends HTMLElement {
  data: { metrics: MetricData[]; conversations: ConversationData[] };
}
interface DetailOverlayEl extends HTMLElement {
  show(metric: MetricData, allMetrics: MetricData[]): void;
}

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
      const { metric, allMetrics } = (e as CustomEvent).detail;
      const overlay = this.shadow.querySelector(
        "hive-detail-overlay"
      ) as DetailOverlayEl | null;
      overlay?.show(metric, allMetrics);
    });

    this.tick();
    setInterval(() => this.tick(), POLL_MS);
  }

  private async tick() {
    try {
      const [pr, mr, cr] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/metrics"),
        fetch("/api/conversations"),
      ]);
      if (!pr.ok || !mr.ok || !cr.ok) throw new Error("fetch failed");

      const p = await pr.json();
      const m = await mr.json();
      const c = await cr.json();

      const header = this.shadow.querySelector(
        "hive-header"
      ) as HeaderEl | null;
      if (header) {
        header.data = {
          online: true,
          serverAddr: p.serverHost + ":" + p.serverPort,
        };
      }

      const metrics: MetricData[] = m.metrics || [];
      const conversations: ConversationData[] = c.conversations || [];

      const total = metrics.length;
      const ok = metrics.filter((r) => r.success).length;
      const rate = total > 0 ? Math.round((ok / total) * 100) : 100;
      const providersCount = new Set(
        (p.providers || [])
          .filter((x: any) => x.keyConfigured)
          .map((x: any) => x.name)
      ).size;
      const flights = metrics
        .filter((r) => r.success && r.ttft != null)
        .map((r) => r.ttft);
      const avgFlight =
        flights.length > 0
          ? Math.round(flights.reduce((a, b) => a + b, 0) / flights.length)
          : null;

      const stats = this.shadow.querySelector("hive-stats") as StatsEl | null;
      if (stats) {
        stats.data = {
          traffic: total,
          successRate: rate,
          providers: providersCount,
          avgLatency: avgFlight,
        };
      }

      const providers: ProviderData[] = (p.providers || []).map((x: any) => ({
        name: x.name,
        model: x.model,
        keyConfigured: x.keyConfigured,
        stabilityScore: x.stabilityScore,
        p95Latency: x.p95Latency,
        meanTokensPerSecond: x.meanTokensPerSecond,
        requestCount: x.requestCount,
      }));

      const swarm = this.shadow.querySelector("hive-swarm") as SwarmEl | null;
      if (swarm) swarm.data = providers;

      const providersEl = this.shadow.querySelector(
        "hive-providers"
      ) as ProvidersEl | null;
      if (providersEl) providersEl.data = providers;

      const tabs = this.shadow.querySelector(
        "hive-activity-tabs"
      ) as TabsEl | null;
      if (tabs) tabs.data = { metrics, conversations };
    } catch {
      const header = this.shadow.querySelector(
        "hive-header"
      ) as HeaderEl | null;
      if (header) {
        header.data = { online: false, serverAddr: "—" };
      }
    }
  }
}

customElements.define("hive-app", HiveApp);
