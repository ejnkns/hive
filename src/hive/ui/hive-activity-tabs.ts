import type { MetricData, ConversationData } from "./types";
import "./hive-activity-log";
import "./hive-conversations";

export class HiveActivityTabs extends HTMLElement {
  private shadow: ShadowRoot;
  private _metrics: MetricData[] = [];
  private _conversations: ConversationData[] = [];
  private _activeTab: "activity" | "conversations" = "activity";

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set data(value: {
    metrics: MetricData[];
    conversations: ConversationData[];
  }) {
    this._metrics = value.metrics;
    this._conversations = value.conversations;
    this.updateChildren();
  }

  connectedCallback() {
    this.render();
    this.updateChildren();
  }

  private render() {
    this.shadow.innerHTML = `
      <style>
        :host { display: block; }
        .tab-bar {
          display: flex;
          gap: 1rem;
          margin-bottom: 0.5rem;
        }
        .tab {
          font-size: 0.625rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
          cursor: pointer;
          padding-bottom: 0.25rem;
          color: var(--muted);
          border-bottom: 2px solid transparent;
        }
        .tab:hover { color: var(--text); }
        .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        .log-wrap {
          background: var(--card);
          border: 1px solid var(--border);
          height: 400px;
          overflow: hidden;
        }
        .view {
          display: block;
          height: 100%;
          overflow-y: scroll;
        }
        .view.hidden { display: none; }
      </style>
      <div class="tab-bar">
        <span class="tab active" data-tab="activity">Activity</span>
        <span class="tab" data-tab="conversations">Conversations</span>
      </div>
      <div class="log-wrap">
        <div class="view" id="activityView"><hive-activity-log></hive-activity-log></div>
        <div class="view hidden" id="conversationsView"><hive-conversations></hive-conversations></div>
      </div>
    `;

    this.shadow.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-tab") as
          | "activity"
          | "conversations";
        this.switchTab(target);
      });
    });
  }

  private switchTab(tab: "activity" | "conversations") {
    this._activeTab = tab;
    this.shadow.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.getAttribute("data-tab") === tab);
    });
    this.shadow
      .querySelector("#activityView")
      ?.classList.toggle("hidden", tab !== "activity");
    this.shadow
      .querySelector("#conversationsView")
      ?.classList.toggle("hidden", tab !== "conversations");
    if (tab === "conversations") {
      this.updateConversations();
    }
  }

  private updateChildren() {
    const log = this.shadow.querySelector("hive-activity-log");
    if (log) (log as any).data = this._metrics;

    if (this._activeTab === "conversations") {
      this.updateConversations();
    }
  }

  private updateConversations() {
    const conv = this.shadow.querySelector("hive-conversations");
    if (conv) (conv as any).data = this._conversations;
  }
}

customElements.define("hive-activity-tabs", HiveActivityTabs);
