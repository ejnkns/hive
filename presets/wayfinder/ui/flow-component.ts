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
  ChatMessage,
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

// === The three expedition themes (skins over the same data) ===

type ExpeditionTheme = "mountain" | "topo" | "stars";

const EXPEDITION_THEMES: readonly ExpeditionTheme[] = [
  "mountain",
  "topo",
  "stars",
];

// Glyphs are single-codepoint dingbats, never emoji (the repo's no-emoji
// rule). The fog node is always a "?" — a crisp question mark sitting on top
// of the visible fog region.
const THEME_GLYPHS: Record<
  ExpeditionTheme,
  {
    base: string;
    summit: string;
    decision: string;
    implementation: string;
    outOfScope: string;
  }
> = {
  mountain: {
    base: "⌂",
    summit: "▲",
    decision: "▴",
    implementation: "▲",
    outOfScope: "⊘",
  },
  topo: {
    base: "⌂",
    summit: "◉",
    decision: "▴",
    implementation: "▲",
    outOfScope: "⊘",
  },
  stars: {
    base: "◈",
    summit: "◉",
    decision: "◍",
    implementation: "◍",
    outOfScope: "⊘",
  },
};

const THEME_ACCENT: Record<ExpeditionTheme, string> = {
  mountain: "#4a9fe0",
  topo: "#58a06a",
  stars: "#5bc0e8",
};

function resolveTheme(config: Record<string, unknown>): ExpeditionTheme {
  const value = config.expeditionTheme;
  if (
    typeof value === "string" &&
    EXPEDITION_THEMES.includes(value as ExpeditionTheme)
  ) {
    return value as ExpeditionTheme;
  }
  return "mountain";
}

// A triangle peak path (apex at x,y; base at y+height).
function peak(x: number, y: number, halfWidth: number, height: number): string {
  return `M ${x - halfWidth} ${y + height} L ${x} ${y} L ${x + halfWidth} ${
    y + height
  } Z`;
}

// An organic contour ring (a slightly wobbled ellipse) — the topo theme's
// contour lines, drawn from a small number of perturbed radii so they read as
// hand-surveyed terrain rather than perfect circles.
function wobblePath(cx: number, cy: number, r: number, seed: number): string {
  const n = 60;
  let d = "";
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const rr =
      r +
      Math.sin(a * 5 + seed) * r * 0.08 +
      Math.sin(a * 9 + seed * 2) * r * 0.04;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.82;
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return `${d}Z`;
}

// The trail sequence: base -> fog -> frontier -> the ordered ascent -> summit.
function trailNodes(nodes: WayfinderNode[]): WayfinderNode[] {
  const base = nodes.find((node) => node.kind === "base");
  const fog = nodes.filter((node) => node.kind === "fog");
  const ready = nodes
    .filter((node) => node.kind === "ready")
    .sort((a, b) => a.x - b.x);
  const ascent = nodes
    .filter((node) => node.order !== undefined)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const summit = nodes.find((node) => node.kind === "summit");
  return [base, ...fog, ...ready, ...ascent, summit].filter(
    (node): node is WayfinderNode => node !== undefined
  );
}

// The first non-empty line of a markdown file, for the depot crates' titles.
function firstLine(text: string): string {
  const first = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return first ?? text.slice(0, 60);
}

// The agent is composing its next reply while the transcript ends on anything
// but an assistant message (a user message it hasn't answered, or a tool
// result mid-loop).
function agentIsThinking(messages: readonly ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last !== undefined && last.role !== "assistant";
}

// Cards on the table sit at alternating small rotations (papers laid on a
// desk) — the sign flips per index so neighbours tilt opposite ways.
function cardRotation(index: number): string {
  const magnitude = 0.4 + ((index * 3) % 4) * 0.3;
  return `${index % 2 === 0 ? -magnitude : magnitude}deg`;
}

export default function (lit: FlowComponentDeps): FlowComponentRegistrations {
  const { LitElement: Base, html, css, nothing, svg } = lit;

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
      mapOpen: { attribute: false },
      themeOverride: { attribute: false },
    };

    static styles = css`
      :host {
        display: block;
        height: 100%;
      }
      .expedition {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        --wf-accent: #4a9fe0;
        --wf-paper: #241f18;
        --wf-paper-edge: #352d22;
        --wf-ink: #f0ead9;
        --wf-body: #b7ad97;
        --wf-font:
          system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial,
          sans-serif;
        font-family: var(--wf-font);
        transition:
          --wf-accent var(--dur-slow) var(--ease-in-out),
          --wf-paper var(--dur-slow) var(--ease-in-out),
          --wf-paper-edge var(--dur-slow) var(--ease-in-out),
          --wf-ink var(--dur-slow) var(--ease-in-out),
          --wf-body var(--dur-slow) var(--ease-in-out);
      }
      .expedition[data-theme="mountain"] {
        --wf-accent: #4a9fe0;
        --wf-paper: #241f18;
        --wf-paper-edge: #352d22;
        --wf-ink: #f0ead9;
        --wf-body: #b7ad97;
      }
      .expedition[data-theme="topo"] {
        --wf-accent: #58a06a;
        --wf-paper: #25221a;
        --wf-paper-edge: #3a3426;
        --wf-ink: #f0ead9;
        --wf-body: #b7ad97;
      }
      .expedition[data-theme="stars"] {
        --wf-accent: #5bc0e8;
        --wf-paper: #10161f;
        --wf-paper-edge: #1e2a3a;
        --wf-ink: #d6e6f5;
        --wf-body: #8ba6c2;
      }
      :host-context(html.light) .expedition {
        --wf-accent: #2f7bb5;
        --wf-paper: #f2ead9;
        --wf-paper-edge: #d9c7a3;
        --wf-ink: #2a2418;
        --wf-body: #6b5f4a;
      }
      :host-context(html.light) .expedition[data-theme="topo"] {
        --wf-accent: #3f7d4d;
        --wf-paper: #f0f2e6;
        --wf-paper-edge: #ccd2b0;
        --wf-ink: #23281a;
        --wf-body: #5f6b4a;
      }
      :host-context(html.light) .expedition[data-theme="stars"] {
        --wf-accent: #2f86b5;
        --wf-paper: #e8eef4;
        --wf-paper-edge: #c3d0e0;
        --wf-ink: #1a2430;
        --wf-body: #4a5b6a;
      }

      .header {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 0.625rem;
        flex-wrap: wrap;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
      }
      .emblem {
        color: var(--wf-accent);
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
      .theme-cycle {
        font-size: 0.5625rem;
        height: 24px;
        padding: 0 0.5rem;
        border-radius: 4px;
        border: 1px dashed var(--wf-accent);
        background: transparent;
        color: var(--wf-accent);
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .table {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 300px) minmax(0, 1fr) minmax(0, 280px);
        gap: 1rem;
        align-items: stretch;
        overflow: hidden;
        border-radius: 18px;
        padding: 1.25rem;
        border: 1px solid var(--border);
        background: var(--wf-paper);
      }
      .expedition[data-theme="mountain"] .table {
        background:
          radial-gradient(
            120% 90% at 50% 10%,
            rgba(255, 255, 255, 0.05),
            transparent 60%
          ),
          repeating-linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.05) 0 2px,
            transparent 2px 6px
          ),
          var(--wf-paper);
      }
      .expedition[data-theme="topo"] .table {
        background:
          radial-gradient(
            120% 90% at 50% 10%,
            rgba(255, 255, 255, 0.04),
            transparent 60%
          ),
          repeating-linear-gradient(
            0deg,
            rgba(0, 0, 0, 0.04) 0 1px,
            transparent 1px 28px
          ),
          repeating-linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.04) 0 1px,
            transparent 1px 28px
          ),
          var(--wf-paper);
      }
      .expedition[data-theme="stars"] .table {
        background:
          radial-gradient(
            120% 100% at 50% 0%,
            rgba(91, 192, 232, 0.08),
            transparent 60%
          ),
          repeating-linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.06) 0 8px,
            transparent 8px 16px
          ),
          var(--wf-paper);
      }
      @media (max-width: 900px) {
        .expedition {
          height: auto;
        }
        .table {
          grid-template-columns: 1fr;
          overflow: visible;
        }
        .column {
          overflow-y: visible;
        }
        .column.center {
          order: -1;
          overflow: visible;
        }
        .map-card {
          height: auto;
          min-height: 60vh;
        }
      }

      .column {
        display: flex;
        flex-direction: column;
        gap: 1.1rem;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
        padding: 0.5rem 0.625rem 0.75rem;
      }
      .column.center {
        overflow: hidden;
        padding: 0;
      }
      .station-head {
        font-size: 0.68rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--wf-body);
        margin: 0 0 0.55rem;
        display: flex;
        align-items: center;
        gap: 0.45rem;
      }
      .station-head::after {
        content: "";
        flex: 1;
        height: 1px;
        background: rgba(203, 185, 143, 0.25);
      }
      .pile {
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
        min-height: 40px;
      }
      .empty {
        font-size: 0.68rem;
        color: var(--muted);
        padding: 0.4rem 0;
      }
      .card .t,
      .card .lbl,
      .crate .t,
      .crate .lbl,
      .journal .txt,
      .dest-note .name,
      .dest-note .sub,
      .node .cap,
      .panel .entry .t,
      .panel .entry .meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .card .body {
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .journal .txt,
      .panel .entry .t {
        min-width: 0;
      }

      .card {
        background: var(--wf-paper);
        border: 1px solid var(--wf-paper-edge);
        border-radius: 10px;
        padding: 0.75rem 0.85rem;
        box-shadow:
          0 2px 0 rgba(0, 0, 0, 0.3),
          0 5px 10px rgba(0, 0, 0, 0.3);
        transform: rotate(var(--rot, 0deg));
        transition:
          transform 0.15s ease,
          box-shadow 0.15s ease,
          border-color 0.15s;
      }
      .card:hover {
        transform: rotate(0deg) translateY(-2px);
      }
      .card .t {
        font-weight: 600;
        font-size: 0.84rem;
        color: var(--wf-ink);
      }
      .card .body {
        font-size: 0.7rem;
        color: var(--wf-body);
        margin-top: 0.28rem;
      }
      .card .t,
      .card .body,
      .journal .txt,
      .crate .t,
      .dest-note .name,
      .node .cap,
      .panel .entry .t {
        font-family: var(--wf-font);
      }
      .stamp {
        display: inline-block;
        font-size: 0.56rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--wf-accent);
        border: 1.5px solid var(--wf-accent);
        border-radius: 4px;
        padding: 0.06rem 0.34rem;
        margin-top: 0.5rem;
        transform: rotate(-3deg);
      }
      .card .lbl {
        font-size: 0.6rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
        margin-top: 0.5rem;
      }
      .card-actions button {
        font: inherit;
        font-size: 0.68rem;
        padding: 0.26rem 0.6rem;
        border-radius: 6px;
        border: 1px solid var(--wf-accent);
        background: transparent;
        color: var(--wf-accent);
        cursor: pointer;
      }
      .card-actions button.primary {
        background: var(--wf-accent);
        color: var(--bg);
        border-color: transparent;
      }
      .card-actions button.destructive {
        background: var(--error);
        color: white;
        border-color: transparent;
      }
      .card-actions button.secondary {
        border-color: var(--border);
        color: var(--muted);
      }
      .card-chat {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        border-top: 1px dashed var(--border);
        padding-top: 0.5rem;
        margin-top: 0.5rem;
      }
      .session-header {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }
      .session-label {
        font-size: 0.5625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--wf-accent);
      }

      .fog-card {
        background: linear-gradient(
          165deg,
          var(--wf-paper),
          var(--wf-paper-edge)
        );
        border: 2px dashed var(--wf-body);
      }
      .fog-title {
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .fog-title .t {
        flex: 1;
        min-width: 0;
      }
      .fog-card .q {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 1.5px solid var(--wf-ink);
        color: var(--wf-ink);
        font-weight: 700;
        font-size: 0.85rem;
        box-shadow:
          0 0 0 4px color-mix(in srgb, var(--wf-body) 18%, transparent),
          0 0 14px color-mix(in srgb, var(--wf-body) 35%, transparent);
      }
      .fog-card .tag {
        display: inline-block;
        margin-top: 0.4rem;
        font-size: 0.56rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--wf-ink);
        background: color-mix(in srgb, var(--wf-body) 25%, transparent);
        border-radius: 999px;
        padding: 0.06rem 0.45rem;
      }

      .journal {
        background: var(--wf-paper);
        border: 1px solid var(--wf-paper-edge);
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
      }
      .journal .entry {
        padding: 0.6rem 0.8rem;
        border-bottom: 1px dashed var(--wf-paper-edge);
        display: flex;
        gap: 0.6rem;
        align-items: baseline;
      }
      .journal .entry:last-child {
        border-bottom: none;
      }
      .journal .cairn {
        color: var(--success);
      }
      .journal .txt {
        font-size: 0.8rem;
        color: var(--wf-ink);
      }

      .crate {
        background: var(--wf-paper);
        border: 1px solid var(--wf-paper-edge);
        border-radius: 10px;
        padding: 0.7rem 0.8rem;
        border-top: 3px solid var(--warning);
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
      }
      .crate.spec {
        border-top-color: var(--wf-accent);
      }
      .crate .lbl {
        font-size: 0.6rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .crate .t {
        font-weight: 600;
        font-size: 0.8rem;
        color: var(--wf-ink);
      }

      .map-card {
        height: 100%;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 0.9rem;
        background: radial-gradient(
          120% 90% at 70% 20%,
          #172030 0%,
          #10151d 55%,
          #0c1015 100%
        );
        position: relative;
      }
      .map-card .map-top {
        flex-shrink: 0;
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }
      .map-card .dest-note {
        flex: 1;
        min-width: 0;
      }
      .map-card .dest-note .name {
        font-weight: 700;
        font-size: 0.8rem;
      }
      .map-card .dest-note .sub {
        font-size: 0.66rem;
        color: var(--muted);
      }
      .map-card .open-map {
        flex-shrink: 0;
        font: inherit;
        font-size: 0.68rem;
        padding: 0.32rem 0.6rem;
        border-radius: 6px;
        border: 1px solid var(--wf-accent);
        background: rgba(91, 192, 232, 0.12);
        color: var(--wf-accent);
        cursor: pointer;
      }
      .map-card svg {
        display: block;
        width: 100%;
        height: 100%;
        flex: 1;
        min-height: 0;
      }

      .map-layout {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: 1fr 300px;
      }
      @media (max-width: 900px) {
        .map-layout {
          flex: none;
          height: auto;
          grid-template-columns: 1fr;
        }
        .canvas {
          min-height: 60vh;
        }
      }
      .canvas {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: #0a0e15;
      }
      .canvas svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
      .back-link {
        position: absolute;
        left: 14px;
        top: 14px;
        z-index: 6;
        font: inherit;
        font-size: 0.7rem;
        padding: 0.32rem 0.6rem;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        cursor: pointer;
      }
      .node {
        position: absolute;
        transform: translate(-50%, -50%);
        text-align: center;
        cursor: pointer;
        z-index: 3;
      }
      .node .glyph {
        line-height: 1;
      }
      .node .cap {
        font-size: 0.62rem;
        color: #e6edf3;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        margin-top: 3px;
        max-width: 17ch;
        line-height: 1.2;
      }
      .node.summit .glyph {
        font-size: 2.3rem;
        color: var(--wf-accent);
      }
      .node.summit .cap {
        font-weight: 700;
      }
      .node.decision .glyph {
        font-size: 1.1rem;
        color: var(--success);
      }
      .node.implementation .glyph {
        font-size: 1.2rem;
        color: var(--wf-accent);
      }
      .node.base .glyph {
        font-size: 1.5rem;
        color: var(--muted);
      }
      .node.out-of-scope .glyph {
        font-size: 1.2rem;
        color: var(--muted);
      }
      .node.fog .glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--surface);
        border: 2px solid #e6edf3;
        color: #e6edf3;
        font-weight: 700;
        font-size: 0.82rem;
        box-shadow:
          0 0 0 5px rgba(138, 147, 160, 0.16),
          0 0 0 11px rgba(138, 147, 160, 0.08);
      }
      .node.ready .glyph {
        display: inline-block;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: var(--wf-accent);
        box-shadow:
          0 0 0 3px rgba(91, 192, 232, 0.25),
          0 0 16px var(--wf-accent);
      }
      .node.resolving .glyph {
        display: inline-block;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: var(--warning);
      }

      .panel {
        border-left: 1px solid var(--border);
        padding: 0.9rem;
        background: var(--surface);
        overflow-y: auto;
      }
      .panel .group {
        margin-bottom: 0.8rem;
      }
      .panel .gh {
        font-size: 0.66rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--muted);
        margin: 0.7rem 0 0.3rem;
      }
      .panel .entry {
        font-size: 0.78rem;
        padding: 0.38rem 0.5rem;
        border-radius: 8px;
        border: 1px solid transparent;
        cursor: pointer;
      }
      .panel .entry .t {
        font-weight: 600;
        color: var(--text);
      }
      .panel .entry .meta {
        font-size: 0.64rem;
        color: var(--muted);
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
    declare mapOpen: boolean;
    declare themeOverride: ExpeditionTheme | undefined;

    private get theme(): ExpeditionTheme {
      return this.themeOverride ?? resolveTheme(this.flow.config);
    }

    // Dev-only: cycle the expedition skin without editing the flow config.
    private cycleTheme() {
      const index = EXPEDITION_THEMES.indexOf(this.theme);
      this.themeOverride =
        EXPEDITION_THEMES[(index + 1) % EXPEDITION_THEMES.length];
    }

    private get model(): WayfinderMap {
      return deriveWayfinderMap(this.entries);
    }

    render() {
      const theme = this.theme;
      return this.mapOpen
        ? this.renderMapView(theme)
        : this.renderTableView(theme);
    }

    private renderTableView(theme: ExpeditionTheme) {
      const model = this.model;
      return html`<div class="expedition" data-theme=${theme}>
        ${this.renderHeader()}
        <div class="table">
          <div class="column left">
            ${this.renderBaseCamp()} ${this.renderBriefingDeck()}
            ${this.renderFogTray()} ${this.renderOnExpedition()}
          </div>
          <div class="column center">${this.renderMapCard(model, theme)}</div>
          <div class="column right">
            ${this.renderJournal()} ${this.renderDepot()}
            ${this.renderOutOfScope()}
          </div>
        </div>
      </div>`;
    }

    private renderMapView(theme: ExpeditionTheme) {
      const model = this.model;
      return html`<div class="expedition" data-theme=${theme}>
        <div class="map-layout">
          <div class="canvas">
            <button class="back-link" type="button" @click=${this.closeMap}>
              ← Back to the table
            </button>
            ${this.mapBackdrop(model.nodes, theme)}
            ${this.mapPaths(model.nodes, theme)}
            ${model.nodes.map((node) => this.renderNode(node, theme))}
          </div>
          <aside class="panel">${this.renderPanel(model)}</aside>
        </div>
      </div>`;
    }

    private mapBackdrop(nodes: WayfinderNode[], theme: ExpeditionTheme) {
      return svg`<svg
        viewBox="0 0 1000 660"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        ${this.drawBackdrop(nodes, theme, 10, 6.6)}
      </svg>`;
    }

    private mapPaths(nodes: WayfinderNode[], theme: ExpeditionTheme) {
      return svg`<svg
        viewBox="0 0 1000 660"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        ${this.drawPaths(nodes, theme, 10, 6.6)}
      </svg>`;
    }

    private renderHeader() {
      return html`<div class="header">
        <span class="emblem">▲</span>
        <div class="title-group">
          <span class="title">${this.flow.label}</span>
          <span class="status">${this.flow.status}</span>
        </div>
        <div class="actions">
          <button
            class="theme-cycle"
            type="button"
            title="dev: cycle the expedition theme"
            @click=${this.cycleTheme}
          >
            ${this.theme}
          </button>
          ${this.availableFlowActions.map((action) => {
            const onClick =
              action.createInstance !== undefined
                ? () => this.onCreate(action.id)
                : () => this.onFlowAction(action.id);
            return html`<button
              class=${action.variant}
              type="button"
              @click=${onClick}
            >
              ${action.label}
            </button>`;
          })}
        </div>
      </div>`;
    }

    // A base-camp card for each charting instance: the destination plus the
    // current session's actions (Done/Cancel for naming and frontier).
    private renderBaseCamp() {
      const charting = this.entries.filter(
        (entry) => entry.workflowId === "charting"
      );
      return html`<div class="station">
        <h2 class="station-head">Base camp</h2>
        <div class="pile">
          ${charting.map((entry, index) => {
            const destination = entry.state.workflowInstanceState.destination;
            return html`<div class="card" style=${`--rot:${cardRotation(index)}`}>
              <div class="lbl">${entry.state.currentState}</div>
              <div class="t">${
                typeof destination === "string" && destination !== ""
                  ? destination
                  : "Base camp"
              }</div>
              ${this.renderActions(entry)} ${this.renderChat(entry)}
            </div>`;
          })}
          ${
            charting.length === 0
              ? html`<div class="empty">No base camp yet.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    // Tickets actively being resolved (research, prototype, grilling, task,
    // recording) — the ascent in flight — with their state actions.
    private renderOnExpedition() {
      const resolving = this.entries.filter(
        (entry) =>
          entry.workflowId === "ticket" &&
          RESOLVING_STATES.includes(entry.state.currentState)
      );
      return html`<div class="station">
        <h2 class="station-head">On expedition</h2>
        <div class="pile">
          ${resolving.map(
            (
              entry,
              index
            ) => html`<div class="card" style=${`--rot:${cardRotation(index)}`}>
              <div class="lbl">${resolvingLabel(entry.state.currentState)}</div>
              <div class="t">${ticketTitle(entry)}</div>
              ${this.renderActions(entry)} ${this.renderChat(entry)}
            </div>`
          )}
          ${
            resolving.length === 0
              ? html`<div class="empty">Nothing in flight.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    // A workflow instance's available state actions (everything is data — the
    // labels and ids come from the entry's availableActions, never hardcoded).
    private renderActions(entry: FlowViewProps["entries"][number]) {
      if (entry.availableActions.length === 0) return nothing;
      return html`<div class="card-actions">
        ${entry.availableActions.map(
          (action) => html`<button
            class=${action.variant}
            type="button"
            @click=${() => this.onAction(entry.id, action.id)}
          >
            ${action.label}
          </button>`
        )}
      </div>`;
    }

    // The live interactive session (naming, frontier, grilling, prototype,
    // task, specing), composed through the default <chat-session> element.
    private renderChat(entry: FlowViewProps["entries"][number]) {
      const state = entry.state;
      if (!state.hasRunningTask || state.runningTaskContext === null) {
        return nothing;
      }
      const ctx = state.runningTaskContext;
      if (ctx.role !== "ai-chat" || ctx.interactive !== true) return nothing;
      const workflowDef = this.workflowDefs.find(
        (def) => def.id === entry.workflowId
      );
      const stateDef = workflowDef?.states.find(
        (workflowState) => workflowState.id === state.currentState
      );
      return html`<div class="card-chat">
        <div class="session-header">
          <span class="session-label"
            >${stateDef?.label ?? state.currentState}</span
          >
        </div>
        <chat-session
          .messages=${ctx.messages}
          .sessionId=${ctx.sessionId}
          .interactive=${ctx.interactive}
          .thinking=${agentIsThinking(ctx.messages)}
          .modelStatus=${ctx.modelStatus}
          @hive-send-message=${(event: CustomEvent<{ content: string }>) => {
            this.onSendMessage(entry.id, event.detail.content);
          }}
        ></chat-session>
      </div>`;
    }

    private renderBriefingDeck() {
      const ready = this.ticketsInState("ready");
      return html`<div class="station">
        <h2 class="station-head">The briefing deck</h2>
        <div class="pile">
          ${ready.map((entry, index) => this.renderDossierCard(entry, index))}
          ${
            ready.length === 0
              ? html`<div class="empty">No claimable tickets yet.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderDossierCard(
      entry: FlowViewProps["entries"][number],
      index: number
    ) {
      const state = entry.state.workflowInstanceState;
      const title = ticketTitle(entry);
      const question =
        typeof state.question === "string" ? state.question : undefined;
      const type = typeof state.type === "string" ? state.type : undefined;
      return html`<div class="card" style=${`--rot:${cardRotation(index)}`}>
        <div class="t">${title}</div>
        ${
          question !== undefined && question !== ""
            ? html`<div class="body">${question}</div>`
            : nothing
        }
        ${
          type !== undefined
            ? html`<span class="stamp">${type}</span>`
            : nothing
        }
        ${this.renderActions(entry)}
      </div>`;
    }

    private renderFogTray() {
      const fog = this.ticketsInState("fog");
      return html`<div class="station">
        <h2 class="station-head">The fog tray</h2>
        <div class="pile">
          ${fog.map((entry, index) => this.renderFogCard(entry, index))}
          ${
            fog.length === 0
              ? html`<div class="empty">The fog is clear.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderFogCard(
      entry: FlowViewProps["entries"][number],
      index: number
    ) {
      return html`<div class="card fog-card" style=${`--rot:${cardRotation(index)}`}>
        <div class="fog-title"><span class="q">?</span><span class="t">${ticketTitle(entry)}</span></div>
        <span class="tag">needs clarity</span>
        ${this.renderActions(entry)}
      </div>`;
    }

    private renderJournal() {
      const closed = this.ticketsInState("closed");
      return html`<div class="station">
        <h2 class="station-head">The journal</h2>
        <div class="journal">
          ${closed.map(
            (entry) => html`<div class="entry">
              <span class="cairn">▴</span>
              <span class="txt">${ticketTitle(entry)}</span>
            </div>`
          )}
          ${
            closed.length === 0
              ? html`<div class="empty">No decisions recorded yet.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderDepot() {
      const builds = this.entries.filter(
        (entry) => entry.workflowId === "build"
      );
      const buildItems = this.entries.filter(
        (entry) => entry.workflowId === "buildItem"
      );
      const spec = this.persistedOutputs["spec.md"];
      const plan = this.persistedOutputs["build-plan.md"];
      const hasSpec = spec !== undefined && spec !== "";
      const hasPlan = plan !== undefined && plan !== "";
      const hasAny =
        hasSpec || hasPlan || builds.length > 0 || buildItems.length > 0;
      return html`<div class="station">
        <h2 class="station-head">The supply depot</h2>
        <div class="pile">
          ${
            hasSpec
              ? html`<div class="crate spec">
                <div class="lbl">manifest · spec</div>
                <div class="t">${firstLine(spec ?? "")}</div>
              </div>`
              : nothing
          }
          ${
            hasPlan
              ? html`<div class="crate">
                <div class="lbl">route plan</div>
                <div class="t">${firstLine(plan ?? "")}</div>
              </div>`
              : nothing
          }
          ${builds.map(
            (
              entry,
              index
            ) => html`<div class="crate" style=${`--rot:${cardRotation(index)}`}>
              <div class="lbl">build · ${entry.state.currentState}</div>
              <div class="t">The implementation phase</div>
              ${this.renderActions(entry)} ${this.renderChat(entry)}
            </div>`
          )}
          ${buildItems.map(
            (
              entry,
              index
            ) => html`<div class="crate" style=${`--rot:${cardRotation(index)}`}>
              <div class="lbl">gear · build item</div>
              <div class="t">${implementationTitle(entry)}</div>
              ${this.renderActions(entry)}
            </div>`
          )}
          ${
            hasAny
              ? nothing
              : html`<div class="empty">No supplies yet — start a build.</div>`
          }
        </div>
      </div>`;
    }

    private renderOutOfScope() {
      const outOfScope = this.ticketsInState("out_of_scope");
      return html`<div class="station">
        <h2 class="station-head">Do not enter</h2>
        <div class="pile">
          ${outOfScope.map(
            (entry) => html`<div class="card">
              <div class="t">⊘ ${ticketTitle(entry)}</div>
              <span class="stamp">ruled out</span>
            </div>`
          )}
          ${
            outOfScope.length === 0
              ? html`<div class="empty">Nothing ruled out.</div>`
              : nothing
          }
        </div>
      </div>`;
    }

    private renderMapCard(model: WayfinderMap, theme: ExpeditionTheme) {
      return html`<div class="map-card">
        <div class="map-top">
          <div class="dest-note">
            <div class="name">${model.destination}</div>
            <div class="sub">Destination</div>
          </div>
          <button class="open-map" type="button" @click=${this.openMap}>
            Open the map view →
          </button>
        </div>
        ${this.miniMap(model, theme)}
      </div>`;
    }

    private miniMap(model: WayfinderMap, theme: ExpeditionTheme) {
      const glyphs = THEME_GLYPHS[theme];
      const accent = THEME_ACCENT[theme];
      const sx = 5.6;
      const sy = 4;
      const summit = model.nodes.find((node) => node.kind === "summit");
      return svg`<svg viewBox="0 0 560 400" role="img" aria-label="Expedition map">
        ${this.drawBackdrop(model.nodes, theme, sx, sy)}
        ${this.drawFrontier(model.nodes, sx, sy, accent)}
        ${this.drawTrail(model.nodes, sx, sy, accent)}
        ${
          summit !== undefined
            ? svg`<text
                x=${summit.x * sx}
                y=${summit.y * sy - 6}
                text-anchor="middle"
                font-size="20"
                fill=${accent}
              >${glyphs.summit}</text>`
            : nothing
        }
        ${model.nodes
          .filter((node) => node.kind !== "base" && node.kind !== "summit")
          .map((node) => this.drawMarker(node, sx, sy))}
      </svg>`;
    }

    private renderNode(node: WayfinderNode, theme: ExpeditionTheme) {
      const glyphs = THEME_GLYPHS[theme];
      const glyph =
        node.kind === "summit"
          ? glyphs.summit
          : node.kind === "base"
            ? glyphs.base
            : node.kind === "decision"
              ? glyphs.decision
              : node.kind === "implementation"
                ? glyphs.implementation
                : node.kind === "out-of-scope"
                  ? glyphs.outOfScope
                  : "";
      const caption =
        node.kind === "fog"
          ? html`<span class="tag">needs clarity</span>`
          : nothing;
      return html`<div
        class="node ${node.kind}"
        style=${`left:${node.x}%;top:${node.y}%`}
        data-id=${node.id}
      >
        <div class="glyph">
          ${
            node.kind === "fog" ||
            node.kind === "ready" ||
            node.kind === "resolving"
              ? ""
              : glyph
          }
        </div>
        <div class="cap">${node.title}</div>
        ${caption}
      </div>`;
    }

    private renderPanel(model: WayfinderMap) {
      return html`${model.groups.map(
        (group) => html`<div class="group">
          <div class="gh">${group.label}</div>
          ${group.nodes.map(
            (node) => html`<div class="entry" data-id=${node.id}>
              <div class="t">${node.title}</div>
              <div class="meta">${node.kind} · ${node.meta}</div>
            </div>`
          )}
        </div>`
      )}`;
    }

    // --- SVG drawing (shared by the mini-map and the full map) ---

    private drawBackdrop(
      nodes: WayfinderNode[],
      theme: ExpeditionTheme,
      sx: number,
      sy: number
    ) {
      const summit = nodes.find((node) => node.kind === "summit");
      const cx = summit?.x ?? 84;
      const cy = summit?.y ?? 10;
      if (theme === "mountain") {
        const conquered = nodes.filter(
          (node) => node.kind === "decision" || node.kind === "implementation"
        );
        return svg`<g>
          ${
            summit !== undefined
              ? svg`<path
                  d=${peak(cx * sx, cy * sy, 60, 120)}
                  fill="rgba(74,159,224,.15)"
                ></path>`
              : nothing
          }
          ${conquered.map(
            (node) => svg`<path
              d=${peak(node.x * sx, node.y * sy, 16, 30)}
              fill="rgba(74,159,224,.12)"
            ></path>`
          )}
        </g>`;
      }
      if (theme === "topo") {
        const conquered = nodes.filter(
          (node) => node.kind === "decision" || node.kind === "implementation"
        );
        const graticule: string[] = [];
        for (let i = 1; i < 10; i += 1) {
          const px = i * sx * 10;
          const py = i * sy * 10;
          graticule.push(
            `M ${px.toFixed(1)} 0 L ${px.toFixed(1)} ${(sy * 100).toFixed(1)} M 0 ${py.toFixed(1)} L ${(sx * 100).toFixed(1)} ${py.toFixed(1)}`
          );
        }
        return svg`<g>
          <path
            d=${graticule.join(" ")}
            fill="none"
            stroke="rgba(255,255,255,.04)"
            stroke-width="1"
          ></path>
          ${[0, 1, 2, 3, 4].map(
            (i) => svg`<path
              d=${wobblePath(cx * sx, cy * sy, (46 + i * 34) * (sx / 10), i)}
              fill="none"
              stroke="rgba(88,160,106,${(0.12 + i * 0.035).toFixed(3)})"
              stroke-width="1"
            ></path>`
          )}
          ${conquered.map(
            (node, index) => svg`<path
              d=${wobblePath(
                node.x * sx,
                node.y * sy,
                18 * (sx / 10),
                node.x + node.y + index
              )}
              fill="none"
              stroke="rgba(88,160,106,.3)"
              stroke-width="1"
            ></path>`
          )}
          <rect
            x="14"
            y="14"
            width="${sx * 100 - 28}"
            height="${sy * 100 - 28}"
            fill="none"
            stroke="rgba(255,255,255,.12)"
            stroke-width="2"
          ></rect>
          <text
            x=${(60 * sx) / 10}
            y=${(70 * sy) / 6.6}
            text-anchor="middle"
            font-size="22"
            fill="rgba(203,185,143,.6)"
          >✦</text>
        </g>`;
      }
      // stars: a starfield + the destination as the system's sun.
      const stars: Array<{ x: number; y: number; r: number; o: number }> = [];
      for (let i = 0; i < 90; i += 1) {
        stars.push({
          x: ((i * 137) % 1000) * (sx / 10),
          y: ((i * 61) % 660) * (sy / 6.6),
          r: 0.4 + ((i * 7) % 10) / 10,
          o: 0.08 + ((i * 11) % 30) / 100,
        });
      }
      return svg`<g>
        ${stars.map(
          (star) => svg`<circle
            cx=${star.x.toFixed(1)}
            cy=${star.y.toFixed(1)}
            r=${star.r.toFixed(2)}
            fill="rgba(230,237,243,${star.o.toFixed(2)})"
          ></circle>`
        )}
        ${
          summit !== undefined
            ? svg`<circle
                cx=${cx * sx}
                cy=${cy * sy}
                r=${26 * (sx / 10)}
                fill="rgba(91,192,232,.22)"
              ></circle>`
            : nothing
        }
      </g>`;
    }

    private drawFrontier(
      nodes: WayfinderNode[],
      sx: number,
      sy: number,
      accent: string
    ) {
      const ready = nodes.filter((node) => node.kind === "ready");
      const y = ready.length > 0 ? ready[0].y : 60;
      const xs = ready.map((node) => node.x);
      const minX = xs.length > 0 ? Math.min(...xs) : 20;
      const maxX = xs.length > 0 ? Math.max(...xs) : 52;
      return svg`<path
        d=${`M ${12 * sx} ${y * sy} Q ${((minX + maxX) / 2) * sx} ${
          (y - 4) * sy
        } ${(maxX + 8) * sx} ${y * sy}`}
        fill="none"
        stroke=${accent}
        stroke-width="1.4"
        stroke-dasharray="2 6"
      ></path>`;
    }

    private drawTrail(
      nodes: WayfinderNode[],
      sx: number,
      sy: number,
      accent: string
    ) {
      const trail = trailNodes(nodes);
      if (trail.length < 2) return nothing;
      const d = trail
        .map((node, index) => {
          const command = index === 0 ? "M" : "L";
          return `${command} ${(node.x * sx).toFixed(1)} ${(node.y * sy).toFixed(1)}`;
        })
        .join(" ");
      return svg`<path
        d=${d}
        fill="none"
        stroke=${accent}
        stroke-width="1.6"
        stroke-dasharray="5 7"
        stroke-linecap="round"
        opacity="0.55"
      ></path>`;
    }

    private drawMarker(node: WayfinderNode, sx: number, sy: number) {
      const colors: Record<string, string> = {
        decision: "#3fb950",
        implementation: THEME_ACCENT[this.theme],
        ready: THEME_ACCENT[this.theme],
        resolving: "#d29922",
        fog: "#f0ead9",
        "out-of-scope": "#9aa4ad",
      };
      const fill = colors[node.kind] ?? "#9aa4ad";
      const radius = node.kind === "fog" ? 5 : 4;
      const isFog = node.kind === "fog";
      return svg`<circle
        cx=${node.x * sx}
        cy=${node.y * sy}
        r=${radius}
        fill=${isFog ? "none" : fill}
        stroke=${isFog ? "#f0ead9" : "none"}
        stroke-width=${isFog ? "1.6" : "0"}
        data-id=${node.id}
      ></circle>`;
    }

    private drawPaths(
      nodes: WayfinderNode[],
      theme: ExpeditionTheme,
      sx: number,
      sy: number
    ) {
      const accent = THEME_ACCENT[theme];
      return svg`<g>
        ${this.drawFrontier(nodes, sx, sy, accent)}
        ${this.drawTrail(nodes, sx, sy, accent)}
      </g>`;
    }

    private ticketsInState(state: string) {
      return this.entries.filter(
        (entry) =>
          entry.workflowId === "ticket" && entry.state.currentState === state
      );
    }

    private openMap() {
      this.mapOpen = true;
    }

    private closeMap() {
      this.mapOpen = false;
    }
  }

  return { components: { "flow-component": FlowComponent } };
}
