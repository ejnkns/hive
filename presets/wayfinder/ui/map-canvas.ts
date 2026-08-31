/** The wayfinder full-map surface (a served component sibling of the served
 * flow component): the real pannable, zoomable map. A Lit element the entry
 * constructs ONCE per open and keeps across renders — never a fresh camera or
 * animation owner per render. It owns the persistent map controller
 * (map-controller.ts): the Canvas draws the theme backdrop decor and the
 * directed curved dependency edges with arrowheads, the DOM node overlays sit
 * at the same camera-projected world points (so the map stays keyboard- and
 * screen-reader-accessible), and the sidebar panel is the complete
 * DOM-backed list representation. Registered under a generated tag through
 * the entry's registrations; the entry references it by constructor, never
 * by tag. */

import type { FlowComponentDeps } from "workflow-engine/workflow-types";
import { MapController } from "./map-controller.ts";
import { nodeStatusGlyph } from "./map-visuals.ts";
import type { WayfinderMap, WayfinderNode } from "./wayfinder-map.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";

// The public surface contract the entry syncs each render: the data props
// (model/theme/hover/focus) plus the callbacks it wires once at construction.
// Intersected with HTMLElement so the constructor type stays assignable to
// the served ElementConstructor contract.
export type MapCanvasElement = HTMLElement & {
  model: WayfinderMap;
  theme: ExpeditionTheme;
  hoverId: string | undefined;
  focusId: string | undefined;
  onClose: (() => void) | undefined;
  onHover: ((id: string | undefined) => void) | undefined;
  onFocus: ((id: string) => void) | undefined;
};

export function createMapCanvas(
  lit: FlowComponentDeps
): new () => MapCanvasElement {
  const { LitElement: Base, html, css, nothing } = lit;

  class MapCanvas extends Base {
    static properties = {
      model: { attribute: false },
      theme: { type: String, reflect: true, attribute: "data-theme" },
      hoverId: { attribute: false },
      focusId: { attribute: false },
      onClose: { attribute: false },
      onHover: { attribute: false },
      onFocus: { attribute: false },
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

      .map-controls {
        position: absolute;
        right: 14px;
        top: 14px;
        z-index: 6;
        display: flex;
        gap: 0.375rem;
      }
      .map-controls button {
        font: inherit;
        font-size: 0.7rem;
        padding: 0.32rem 0.6rem;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        cursor: pointer;
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
    declare hoverId: string | undefined;
    declare focusId: string | undefined;
    declare onClose: (() => void) | undefined;
    declare onHover: ((id: string | undefined) => void) | undefined;
    declare onFocus: ((id: string) => void) | undefined;

    // The persistent controller: created once per element instance (the entry
    // keeps the same instance across renders), mounted when the element
    // attaches, disposed when it detaches. The camera, layout positions, and
    // animation owner live here — never in a render.
    private controller: MapController;

    constructor() {
      super();
      this.controller = new MapController({
        onFocus: (id) => this.onFocus?.(id),
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

    // The hl/focus class suffix: a focused element stays lit until its pulse
    // clears, and hovering lights the counterpart in the other surface.
    private hotClass(id: string): string {
      if (this.focusId === id) return " hl focus";
      if (this.hoverId === id) return " hl";
      return "";
    }

    // Enter/Space focus an element the same way a click does, so keyboard
    // navigation gets the pulse too.
    private keydownFocus(event: KeyboardEvent, id: string): void {
      if (event.key !== "Enter" && event.key !== " ") return;
      this.onFocus?.(id);
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
          <div class="map-controls">
            <button
              class="fit"
              type="button"
              title="Fit the whole map into view"
              @click=${() => this.controller.fit()}
            >
              Fit
            </button>
            <button
              class="reset"
              type="button"
              title="Snap back to the fitted view"
              @click=${() => this.controller.reset()}
            >
              Reset
            </button>
          </div>
          <button class="back-link" type="button" @click=${() => this.onClose?.()}>
            ← Back to the table
          </button>
        </div>
        <aside class="panel">${this.renderPanel(model)}</aside>
      </div>`;
    }

    private renderNode(node: WayfinderNode) {
      const glyph = nodeStatusGlyph(node.presentation, this.theme);
      const caption =
        node.presentation === "fog"
          ? html`<span class="tag">needs clarity</span>`
          : nothing;
      const id = node.id;
      return html`<div
        class="node ${node.presentation}${this.hotClass(id)}"
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
              class="entry${this.hotClass(node.id)}"
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
