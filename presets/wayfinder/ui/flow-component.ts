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

// === The map derivation (pure, exported for tests) ===
//
// The served module cannot value-import a separate helper (served modules are
// standalone blobs), so the derivation lives here as a named export: the test
// suite imports it directly as TypeScript, while the served blob reads only
// the default factory. Both the table's mini-map and the full map render from
// the same model. Hardcoded wayfinder state ids are fine here — this IS
// wayfinder (the no-hardcoding invariant applies to the generic surface, not
// to a preset's own data mapping).

export type WayfinderNodeKind =
  | "base"
  | "fog"
  | "ready"
  | "resolving"
  | "decision"
  | "out-of-scope"
  | "implementation"
  | "summit";

export type WayfinderGroupId =
  | "base"
  | "fog"
  | "frontier"
  | "ascent"
  | "out-of-scope"
  | "summit";

export type WayfinderNode = {
  id: string;
  kind: WayfinderNodeKind;
  title: string;
  meta: string;
  x: number;
  y: number;
  workflowId: string;
  state: string;
  instanceId?: string;
  order?: number;
};

export type WayfinderGroup = {
  id: WayfinderGroupId;
  label: string;
  nodes: WayfinderNode[];
};

export type WayfinderMap = {
  nodes: WayfinderNode[];
  groups: WayfinderGroup[];
  destination: string;
};

const RESOLVING_STATES = [
  "resolving_research",
  "resolving_prototype",
  "resolving_grilling",
  "resolving_task",
  "resolving_task_hitl",
  "recording",
];

export function deriveWayfinderMap(
  entries: FlowViewProps["entries"]
): WayfinderMap {
  const charting = entries.find((entry) => entry.workflowId === "charting");
  const tickets = entries.filter((entry) => entry.workflowId === "ticket");
  const builds = entries.filter((entry) => entry.workflowId === "build");
  const buildItems = entries.filter(
    (entry) => entry.workflowId === "buildItem"
  );

  const destination =
    typeof charting?.state.workflowInstanceState.destination === "string"
      ? (charting.state.workflowInstanceState.destination as string)
      : "Destination";

  const nodes: WayfinderNode[] = [];

  if (charting !== undefined) {
    nodes.push({
      id: "base",
      kind: "base",
      title: "Base camp",
      meta: "charting",
      x: 12,
      y: 84,
      workflowId: "charting",
      state: charting.state.currentState,
      instanceId: charting.id,
    });
  }

  const fog = tickets.filter((entry) => entry.state.currentState === "fog");
  fog.forEach((entry, index) => {
    nodes.push({
      id: entry.id,
      kind: "fog",
      title: ticketTitle(entry),
      meta: "needs clarity",
      x: 24 + (index % 3) * 6,
      y: 73 + Math.floor(index / 3) * 5,
      workflowId: "ticket",
      state: "fog",
      instanceId: entry.id,
    });
  });

  const ready = tickets.filter((entry) => entry.state.currentState === "ready");
  ready.forEach((entry, index) => {
    nodes.push({
      id: entry.id,
      kind: "ready",
      title: ticketTitle(entry),
      meta: `${ticketType(entry)} · claim`,
      x: frontierX(index, ready.length),
      y: 60,
      workflowId: "ticket",
      state: "ready",
      instanceId: entry.id,
    });
  });

  const resolving = tickets.filter((entry) =>
    RESOLVING_STATES.includes(entry.state.currentState)
  );
  const decisions = tickets.filter(
    (entry) => entry.state.currentState === "closed"
  );
  const outOfScope = tickets.filter(
    (entry) => entry.state.currentState === "out_of_scope"
  );

  // The ascent is the one ordered sub-path: resolving -> decisions ->
  // implementations -> the summit. Everything else is grouped, not chained.
  const ascent: WayfinderNode[] = [];
  resolving.forEach((entry, index) => {
    ascent.push({
      id: entry.id,
      kind: "resolving",
      title: ticketTitle(entry),
      meta: resolvingLabel(entry.state.currentState),
      x: 56,
      y: 50 - index * 3,
      workflowId: "ticket",
      state: entry.state.currentState,
      instanceId: entry.id,
    });
  });
  decisions.forEach((entry, index) => {
    ascent.push({
      id: entry.id,
      kind: "decision",
      title: ticketTitle(entry),
      meta: ticketType(entry),
      x: 52 - index * 3,
      y: 38 - index * 5,
      workflowId: "ticket",
      state: "closed",
      instanceId: entry.id,
    });
  });
  [...builds, ...buildItems].forEach((entry, index) => {
    ascent.push({
      id: entry.id,
      kind: "implementation",
      title: implementationTitle(entry),
      meta:
        entry.workflowId === "buildItem"
          ? "build item"
          : entry.state.currentState,
      x: 70 + index * 2,
      y: 17 - index * 3,
      workflowId: entry.workflowId,
      state: entry.state.currentState,
      instanceId: entry.id,
    });
  });
  ascent.forEach((node, index) => {
    node.order = index;
  });
  nodes.push(...ascent);

  outOfScope.forEach((entry, index) => {
    nodes.push({
      id: entry.id,
      kind: "out-of-scope",
      title: ticketTitle(entry),
      meta: "ruled out",
      x: 6 + index * 4,
      y: 92,
      workflowId: "ticket",
      state: "out_of_scope",
      instanceId: entry.id,
    });
  });

  nodes.push({
    id: "summit",
    kind: "summit",
    title: destination,
    meta: "destination",
    x: 84,
    y: 10,
    workflowId: "charting",
    state: charting?.state.currentState ?? "",
  });

  return { nodes, groups: buildGroups(nodes), destination };
}

function ticketTitle(entry: FlowViewProps["entries"][number]): string {
  const state = entry.state.workflowInstanceState;
  if (typeof state.title === "string" && state.title !== "") return state.title;
  if (typeof state.brief === "string" && state.brief !== "") return state.brief;
  return entry.id;
}

function ticketType(entry: FlowViewProps["entries"][number]): string {
  const type = entry.state.workflowInstanceState.type;
  return typeof type === "string" ? type : "ticket";
}

function implementationTitle(entry: FlowViewProps["entries"][number]): string {
  if (entry.workflowId === "buildItem") {
    const ticket = entry.state.workflowInstanceState.ticket;
    if (typeof ticket === "object" && ticket !== null) {
      const title = (ticket as Record<string, unknown>).title;
      if (typeof title === "string" && title !== "") return title;
    }
    return "Build item";
  }
  return "Build";
}

function frontierX(index: number, count: number): number {
  if (count <= 1) return 33;
  return 20 + (index * 26) / (count - 1);
}

function resolvingLabel(state: string): string {
  switch (state) {
    case "resolving_research":
      return "research";
    case "resolving_prototype":
      return "prototype";
    case "resolving_grilling":
      return "grilling";
    case "resolving_task":
      return "task";
    case "resolving_task_hitl":
      return "task (session)";
    case "recording":
      return "recording";
    default:
      return state;
  }
}

function buildGroups(nodes: WayfinderNode[]): WayfinderGroup[] {
  const defs: Array<{
    id: WayfinderGroupId;
    label: string;
    kinds: WayfinderNodeKind[];
  }> = [
    { id: "base", label: "Base camp", kinds: ["base"] },
    { id: "fog", label: "The fog", kinds: ["fog"] },
    { id: "frontier", label: "The frontier", kinds: ["ready"] },
    {
      id: "ascent",
      label: "The ascent",
      kinds: ["resolving", "decision", "implementation"],
    },
    { id: "out-of-scope", label: "Do not enter", kinds: ["out-of-scope"] },
    { id: "summit", label: "The summit", kinds: ["summit"] },
  ];
  return defs.map((def) => ({
    id: def.id,
    label: def.label,
    nodes: nodes.filter((node) => def.kinds.includes(node.kind)),
  }));
}

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
