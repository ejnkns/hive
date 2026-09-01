/** The wayfinder full-map surface (a served component sibling of the served
 * flow component): the real pannable, zoomable map. A Lit element the entry
 * constructs ONCE per open and keeps across renders — never a fresh camera or
 * animation owner per render. It owns the persistent map controller
 * (map-controller.ts): the Canvas draws the theme backdrop decor and the
 * directed curved dependency edges with arrowheads, the DOM node overlays sit
 * at the same camera-projected world points (so the map stays keyboard- and
 * screen-reader-accessible), and the sidebar panel is the complete
 * DOM-backed list representation. The map shell (map-shell.ts) renders the
 * HUD chrome — flow identity, counts, progress, legend, actions, the Fit/
 * Reset controls, and the Map/Table toggle — and composes this surface by
 * constructor; the surface itself carries only the map and its panel.
 * Registered under a generated tag through the entry's registrations; the
 * entry references it by constructor, never by tag. */

import type { PropertyValues } from "lit";
import type { FlowComponentDeps } from "workflow-engine/workflow-types";
import { MapController, prefersReducedMotion } from "./map-controller.ts";
import { nodeStatusGlyph } from "./map-visuals.ts";
import type { WayfinderMap, WayfinderNode } from "./wayfinder-map.ts";
import { deriveMapTransitions } from "./wayfinder-map-transitions.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";

// The public surface contract the shell syncs each render: the data props
// (model/theme/hover/focus/selected), the callbacks it wires once at
// construction, and the camera controls the HUD's Fit/Reset buttons call.
// Intersected with HTMLElement so the constructor type stays assignable to
// the served ElementConstructor contract.
export type MapCanvasElement = HTMLElement & {
  model: WayfinderMap;
  theme: ExpeditionTheme;
  // The host's snapshot revision stamp (FlowViewFlow.revision). A present,
  // unchanged stamp means the snapshot was re-delivered with identical
  // content, so the live-update transitions diff is skipped; an absent stamp
  // (degraded path) always diffs.
  revision: number | undefined;
  hoverId: string | undefined;
  focusId: string | undefined;
  /** The durable drawer selection — the node renders a persistent highlight
   * distinct from the transient hover/focus pulse. */
  selectedId: string | undefined;
  onHover: ((id: string | undefined) => void) | undefined;
  onFocus: ((id: string) => void) | undefined;
  /** A tap that hit no node (blank-map dismissal of an open drawer). */
  onBlankTap: (() => void) | undefined;
  /** Fit the whole map into the viewport (the HUD's Fit button). */
  fit(): void;
  /** Snap back to the fitted view (the HUD's Reset button). */
  reset(): void;
};

export function createMapCanvas(
  lit: FlowComponentDeps
): new () => MapCanvasElement {
  const { LitElement: Base, html, css, nothing } = lit;

  class MapCanvas extends Base {
    static properties = {
      model: { attribute: false },
      theme: { type: String, reflect: true, attribute: "data-theme" },
      revision: { attribute: false },
      hoverId: { attribute: false },
      focusId: { attribute: false },
      selectedId: { attribute: false },
      onHover: { attribute: false },
      onFocus: { attribute: false },
      onBlankTap: { attribute: false },
    };

    static styles = css`
      :host {
        flex: 1;
        min-height: 0;
        display: flex;
      }
      :host([data-theme="stars"]) {
        color: #f6f8fa;
      }
      :host-context(html.light):host([data-theme="stars"]) {
        color: #0a0e15;
      }

      .map-layout {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 300px;
      }
      @media (max-width: 900px) {
        :host {
          flex: none;
        }
        .map-layout {
          height: auto;
          grid-template-columns: 1fr;
        }
        .map-surface {
          min-height: 60vh;
        }
      }

      .map-surface {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: var(--map-backdrop, #0a0e15);
        touch-action: none;
      }
      .map-surface canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
      .map-nodes {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .node {
        position: absolute;
        left: 0;
        top: 0;
        pointer-events: auto;
        transform: translate(var(--node-x, 0px), var(--node-y, 0px))
          translate(-50%, -50%);
        text-align: center;
        cursor: pointer;
        z-index: 3;
        will-change: transform;
      }
      .node.hl {
        transform: translate(var(--node-x, 0px), var(--node-y, 0px))
          translate(-50%, -50%) scale(1.18);
      }
      .node.hl .cap {
        color: #ffffff;
      }
      /* The durable drawer selection: a persistent ring around the glyph, so
         the selected node stays identifiable after the focus pulse clears.
         Colour is an accent — the .cap caption shows whenever the node is
         selected, hovered, or focused. */
      .node.selected .glyph {
        outline: 2px solid var(--wf-accent);
        outline-offset: 3px;
        border-radius: 999px;
      }
      .node.focus {
        animation: focuspulse 1s ease-in-out 2;
      }
      @keyframes focuspulse {
        0%,
        100% {
          transform: translate(var(--node-x, 0px), var(--node-y, 0px))
            translate(-50%, -50%) scale(1);
        }
        50% {
          transform: translate(var(--node-x, 0px), var(--node-y, 0px))
            translate(-50%, -50%) scale(1.45);
        }
      }
      .node:focus-visible {
        outline: 2px solid rgba(91, 192, 232, 0.45);
        border-radius: 8px;
      }
      .node .glyph {
        line-height: 1;
      }
      .node .cap {
        display: none;
        font-size: 0.62rem;
        color: #e6edf3;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        margin-top: 3px;
        max-width: 17ch;
        line-height: 1.2;
      }
      .node .tag {
        display: none;
      }
      .node.hl .cap,
      .node.focus .cap,
      .node:focus-within .cap {
        display: block;
      }
      .node.hl .tag,
      .node.focus .tag,
      .node:focus-within .tag {
        display: inline-block;
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
      .node.frontier .glyph {
        display: inline-block;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: var(--wf-accent);
        box-shadow:
          0 0 0 3px rgba(91, 192, 232, 0.25),
          0 0 16px var(--wf-accent);
      }
      .node.blocked .glyph {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--muted);
        border: 1px solid rgba(154, 164, 173, 0.6);
      }
      .node.active .glyph {
        display: inline-block;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: var(--warning);
      }

      @media (prefers-reduced-motion: reduce) {
        .node.focus {
          animation: none;
        }
      }

      /* The live-update marks: a node that just arrived plays the entrance
         (fade + grow into its camera-projected place); a node whose derived
         presentation just changed flares once (a single pulse, with its
         caption shown so the change is not motion-only). Both play once and
         are inert afterwards — ordinary data refreshes never move the
         constellation or repeat the marks. */
      .node.enter {
        animation: node-enter 0.45s ease-out;
      }
      @keyframes node-enter {
        from {
          opacity: 0;
          transform: translate(var(--node-x, 0px), var(--node-y, 0px))
            translate(-50%, -50%) scale(0.4);
        }
        to {
          opacity: 1;
          transform: translate(var(--node-x, 0px), var(--node-y, 0px))
            translate(-50%, -50%) scale(1);
        }
      }
      .node.flare {
        animation: flare-pulse 1s ease-in-out 1;
      }
      .node.flare .cap {
        display: block;
      }
      @keyframes flare-pulse {
        0%,
        100% {
          transform: translate(var(--node-x, 0px), var(--node-y, 0px))
            translate(-50%, -50%) scale(1);
        }
        40% {
          transform: translate(var(--node-x, 0px), var(--node-y, 0px))
            translate(-50%, -50%) scale(1.4);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .node.enter,
        .node.flare {
          animation: none;
        }
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
      .panel .entry.hl {
        background: rgba(91, 192, 232, 0.1);
        border-color: rgba(91, 192, 232, 0.3);
      }
      .panel .entry.hl .card-title {
        color: #ffffff;
      }
      .panel .entry.selected {
        background: color-mix(in srgb, var(--wf-accent) 14%, transparent);
        border-color: color-mix(in srgb, var(--wf-accent) 55%, transparent);
      }
      .panel .entry.selected .card-title {
        color: var(--wf-accent);
      }
      .panel .entry.focus {
        animation: entrypulse 1s ease-in-out 2;
      }
      @keyframes entrypulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.06);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel .entry.focus {
          animation: none;
        }
      }
      .panel .entry:focus-visible {
        outline: 1px solid rgba(91, 192, 232, 0.5);
      }
      .panel .entry .card-title {
        font-weight: 600;
        color: var(--text);
      }
      .panel .entry .meta {
        font-size: 0.64rem;
        color: var(--muted);
      }
      .node .cap,
      .panel .entry .card-title,
      .panel .entry .meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .panel .entry .card-title {
        min-width: 0;
      }
      .node .cap,
      .panel .entry .card-title {
        font-family: var(--wf-font);
      }
    `;

    declare model: WayfinderMap;
    declare theme: ExpeditionTheme;
    declare revision: number | undefined;
    declare hoverId: string | undefined;
    declare focusId: string | undefined;
    declare selectedId: string | undefined;
    declare onHover: ((id: string | undefined) => void) | undefined;
    declare onFocus: ((id: string) => void) | undefined;
    declare onBlankTap: (() => void) | undefined;

    // The persistent controller: created once per element instance (the entry
    // keeps the same instance across renders), mounted when the element
    // attaches, disposed when it detaches. The camera, layout positions, and
    // animation owner live here — never in a render.
    private controller: MapController;

    // The one-shot live-update marks, keyed by node id and derived in
    // willUpdate from the previous snapshot: arrived ids play the entrance,
    // presentation-changed ids flare once. Non-reactive — render reads them;
    // only the next model change that actually transitions something
    // rewrites them, so unrelated re-renders (hover, focus pulses) never cut
    // a playing animation or re-trigger it.
    private enterIds: ReadonlySet<string> = new Set();
    private flareIds: ReadonlySet<string> = new Set();

    constructor() {
      super();
      this.controller = new MapController({
        onFocus: (id) => this.onFocus?.(id),
        onBlankTap: () => this.onBlankTap?.(),
      });
    }

    connectedCallback(): void {
      super.connectedCallback();
      // A reconnect (the map reopens with the same instance) re-mounts the
      // controller; the first attach mounts in firstUpdated after render.
      if (this.hasUpdated) this.mountSurface();
    }

    firstUpdated(): void {
      this.mountSurface();
    }

    disconnectedCallback(): void {
      super.disconnectedCallback();
      this.controller.dispose();
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
      // Derived live-update feedback, only on a model change: diff the
      // previous snapshot against the next one (the pure transitions seam).
      // A present, unchanged revision stamp means the host re-delivered
      // identical content — the diff would find nothing — so it is skipped
      // entirely; an absent stamp (degraded path) always diffs. Reduced
      // motion drops the motion marks entirely; the class changes
      // themselves are the DOM trace, and the CSS media query backs them up.
      if (!changed.has("model") || this.model === undefined) return;
      if (this.revision !== undefined && !changed.has("revision")) return;
      const transitions = deriveMapTransitions(
        changed.get("model"),
        this.model
      );
      if (
        transitions.addedIds.length === 0 &&
        transitions.statusChanges.length === 0
      )
        return;
      const reducedMotion = prefersReducedMotion();
      this.enterIds = reducedMotion ? new Set() : new Set(transitions.addedIds);
      this.flareIds = reducedMotion
        ? new Set()
        : new Set(transitions.statusChanges.map((change) => change.id));
    }

    protected override updated(): void {
      // Runs after every render: adopt the latest model/theme (a live update
      // warm-lays only new ids and never moves the camera) and re-position the
      // node overlays the render just refreshed.
      if (this.model !== undefined) {
        this.controller.update(this.model, this.theme);
      }
    }

    private mountSurface(): void {
      const surface =
        this.renderRoot.querySelector<HTMLElement>(".map-surface");
      if (surface !== null) this.controller.mount(surface);
    }

    // The state class suffix: a focused element stays lit until its pulse
    // clears, hovering lights the counterpart in the other surface, and the
    // durable selection renders its own persistent highlight (distinct from
    // the transient hover/focus pulse).
    private stateClass(id: string): string {
      const focus = this.focusId === id;
      const hover = this.hoverId === id;
      const selected = this.selectedId === id;
      return `${hover || focus ? " hl" : ""}${focus ? " focus" : ""}${
        selected ? " selected" : ""
      }`;
    }

    // Enter/Space focus an element the same way a click does, so keyboard
    // navigation gets the pulse too.
    private keydownFocus(event: KeyboardEvent, id: string): void {
      if (event.key !== "Enter" && event.key !== " ") return;
      this.onFocus?.(id);
    }

    /** Fit the whole map into view — called by the shell's HUD Fit button. */
    fit(): void {
      this.controller.fit();
    }

    /** Snap back to the fitted view — called by the shell's HUD Reset
     * button. */
    reset(): void {
      this.controller.reset();
    }

    render() {
      const model = this.model;
      if (model === undefined) return nothing;
      return html`<div class="map-layout">
        <div
          class="map-surface"
          role="group"
          aria-label="Expedition map — use the panel or the node markers to select tickets"
        >
          <canvas class="map-canvas" aria-hidden="true"></canvas>
          <div class="map-nodes">
            ${model.nodes.map((node) => this.renderNode(node))}
          </div>
        </div>
        <aside class="panel">${this.renderPanel(model)}</aside>
      </div>`;
    }

    // The one-shot live-update class suffix: `enter` for a node that just
    // arrived, `flare` for one whose presentation just changed (see
    // willUpdate).
    private transitionClass(id: string): string {
      return `${this.enterIds.has(id) ? " enter" : ""}${
        this.flareIds.has(id) ? " flare" : ""
      }`;
    }

    private renderNode(node: WayfinderNode) {
      const glyph = nodeStatusGlyph(node.presentation, this.theme);
      const caption =
        node.presentation === "fog"
          ? html`<span class="tag">needs clarity</span>`
          : nothing;
      const id = node.id;
      return html`<div
        class="node ${node.presentation}${this.stateClass(id)}${this.transitionClass(id)}"
        data-id=${id}
        tabindex="0"
        @mouseenter=${() => this.onHover?.(id)}
        @mouseleave=${() => this.onHover?.(undefined)}
        @focus=${() => this.onHover?.(id)}
        @blur=${() => this.onHover?.(undefined)}
        @click=${() => this.onFocus?.(id)}
        @keydown=${(event: KeyboardEvent) => this.keydownFocus(event, id)}
      >
        <div class="glyph">${glyph}</div>
        <div class="cap">${node.title}</div>
        ${caption}
      </div>`;
    }

    private renderPanel(model: WayfinderMap) {
      return html`${model.groups.map(
        (group) => html`<div class="group">
          <div class="gh">${group.label}</div>
          ${group.nodes.map(
            (node) => html`<div
              class="entry${this.stateClass(node.id)}"
              data-id=${node.id}
              tabindex="0"
              @mouseenter=${() => this.onHover?.(node.id)}
              @mouseleave=${() => this.onHover?.(undefined)}
              @focus=${() => this.onHover?.(node.id)}
              @blur=${() => this.onHover?.(undefined)}
              @click=${() => this.onFocus?.(node.id)}
              @keydown=${(event: KeyboardEvent) =>
                this.keydownFocus(event, node.id)}
            >
              <div class="card-title">${node.title}</div>
              <div class="meta">${node.presentation} · ${node.meta}</div>
            </div>`
          )}
        </div>`
      )}`;
    }
  }

  return MapCanvas;
}
