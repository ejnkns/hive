/** The wayfinder flow component (served component "flow-component"): the
 * flow-level custom view rendering the WHOLE flow-instance page body. The
 * expedition chrome — a header (emblem, destination, status, flow actions), the
 * real charted map (the persisted map.md), and a frontier status line — above
 * each workflow's section. Sections compose the canonical
 * <workflow-board-content> (a DEFAULT element — served modules can only
 * reference default elements by tag; the served instance cards resolve through
 * the registry inside it). The per-workflow workflow-view components
 * (expedition-map, frontier-board, build-pipeline) remain the fallback layer
 * if this component fails to load. */

import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
  FlowViewProps,
} from "workflow-engine/workflow-types";

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing } = lit;

  class FlowComponent extends Base {
    static properties = {
      flow: { attribute: false },
      workflowDefs: { attribute: false },
      entries: { attribute: false },
      customKinds: { attribute: false },
      workflowCounts: { attribute: false },
      availableFlowActions: { attribute: false },
      persistedOutputs: { attribute: false },
      persistedOutputDirs: { attribute: false },
      onAction: { attribute: false },
      onSendMessage: { attribute: false },
      onPatchState: { attribute: false },
      onSelect: { attribute: false },
      onFlowAction: { attribute: false },
      onCreate: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
      }
      .expedition {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        flex-wrap: wrap;
        padding: 0.75rem 0.875rem;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
      }
      .emblem {
        font-family: var(--font-mono, monospace);
        color: var(--flow-accent, var(--accent));
        font-size: 1.25rem;
        line-height: 1;
      }
      .title-group {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
      }
      .title {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--text);
      }
      .status {
        font-size: 0.625rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
      }
      .actions {
        margin-left: auto;
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }
      .actions button {
        font-family: inherit;
        font-size: 0.625rem;
        height: 24px;
        padding: 0 0.5rem;
        border-radius: 4px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        cursor: pointer;
      }
      .actions button.primary {
        background: var(--success);
        color: var(--bg);
        border-color: transparent;
      }
      .actions button.destructive {
        background: var(--error);
        color: white;
        border-color: transparent;
      }
      .map-card {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        padding: 0.75rem 0.875rem;
      }
      .map-head {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        margin-bottom: 0.375rem;
      }
      .map-title {
        font-size: 0.6875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text);
      }
      .map-frontier {
        margin-left: auto;
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--muted);
      }
      .section {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
    `;

    declare flow: FlowViewProps["flow"];
    declare workflowDefs: FlowViewProps["workflowDefs"];
    declare entries: FlowViewProps["entries"];
    declare customKinds: FlowViewProps["customKinds"];
    declare workflowCounts: FlowViewProps["workflowCounts"];
    declare availableFlowActions: FlowViewProps["availableFlowActions"];
    declare persistedOutputs: FlowViewProps["persistedOutputs"];
    declare persistedOutputDirs: FlowViewProps["persistedOutputDirs"];
    declare onAction: FlowViewProps["onAction"];
    declare onSendMessage: FlowViewProps["onSendMessage"];
    declare onPatchState: FlowViewProps["onPatchState"];
    declare onSelect: FlowViewProps["onSelect"];
    declare onFlowAction: FlowViewProps["onFlowAction"];
    declare onCreate: FlowViewProps["onCreate"];

    render() {
      return html`<div class="expedition">
        ${this.renderHeader()}
        ${this.renderMapCard()}
        <div class="section">${this.renderSection("charting")}</div>
        <div class="section">${this.renderSection("ticket")}</div>
        <div class="section">${this.renderSection("build")}</div>
        <div class="section">${this.renderSection("buildItem")}</div>
      </div>`;
    }

    private renderHeader() {
      return html`<div class="header">
        <span class="emblem">▲</span>
        <div class="title-group">
          <span class="title">${this.flow.label}</span>
          <span class="status">${this.flow.status}</span>
        </div>
        <div class="actions">
          ${this.availableFlowActions.map((action) => {
            const onCreate =
              action.createInstance !== undefined
                ? () => this.onCreate(action.id)
                : undefined;
            const onFlowAction =
              action.createInstance === undefined
                ? () => this.onFlowAction(action.id)
                : undefined;
            return html`<button
              class=${action.variant}
              type="button"
              @click=${onCreate ?? onFlowAction}
            >
              ${action.label}
            </button>`;
          })}
        </div>
      </div>`;
    }

    // The expedition map card: the real persisted map.md (the charting agent's
    // settled map), with a frontier status line derived from the ticket
    // workflow's counts. The map is markdown; markdown-view renders it.
    private renderMapCard() {
      const map = this.persistedOutputs["map.md"] ?? "";
      const ticket = this.workflowCounts.find(
        (workflow) => workflow.workflowId === "ticket"
      );
      const byState = ticket?.byState ?? {};
      const fog = byState["fog"] ?? 0;
      const frontier = byState["ready"] ?? 0;
      const decisions = byState["closed"] ?? 0;
      if (map === "" && ticket === undefined) return nothing;
      return html`<div class="map-card">
        <div class="map-head">
          <span class="map-title">Expedition map</span>
          <span class="map-frontier"
            >fog ${fog} · frontier ${frontier} · decisions ${decisions}</span
          >
        </div>
        ${map !== "" ? html`<markdown-view .content=${map}></markdown-view>` : nothing}
      </div>`;
    }

    // A workflow's section: the canonical board/list (with its served
    // instance card resolved through the registry), composed under the
    // expedition chrome.
    private renderSection(workflowId: string) {
      const { workflowDef, entries } = this.section(workflowId);
      if (workflowDef === undefined) return nothing;
      return html`<workflow-board-content
        .workflowDef=${workflowDef}
        .entries=${entries}
        .customKinds=${this.customKinds}
        .onAction=${this.onAction}
        .onSendMessage=${this.onSendMessage}
        .onPatchState=${this.onPatchState}
      ></workflow-board-content>`;
    }

    private section(workflowId: string) {
      const workflowDef = this.workflowDefs.find(
        (def) => def.id === workflowId
      );
      const entries = this.entries.filter(
        (entry) => entry.workflowId === workflowId
      );
      return { workflowDef, entries };
    }
  }

  return { components: { "flow-component": FlowComponent } };
}
