/** The wayfinder full-map view (module-set sibling of the served flow
 * component): the map layout, canvas, nodes, and sidebar panel as a local
 * class composed by constructor — the entry constructs one per render and
 * embeds its template. It is never registered as a custom element and never
 * referenced by tag (served modules are registered under generated tags and
 * cannot reference each other by tag; constructor composition needs no
 * registration). Its styles join the entry's shadow root, so the map inherits
 * the expedition theme variables set on the entry's .expedition chrome. */

import type { FlowComponentDeps } from "workflow-engine/workflow-types";
import { createWayfinderDrawing } from "./wayfinder-drawing.ts";
import type { WayfinderMap, WayfinderNode } from "./wayfinder-map.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";
import { THEME_ACCENT, THEME_GLYPHS } from "./wayfinder-themes.ts";

export type MapCanvasProps = {
  model: WayfinderMap;
  theme: ExpeditionTheme;
  onClose: () => void;
};

export function createMapCanvas(lit: FlowComponentDeps) {
  const { html, css, svg, nothing } = lit;
  const drawing = createWayfinderDrawing(lit);

  class MapCanvas {
    static styles = css`
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
      .node .cap,
      .panel .entry .t,
      .panel .entry .meta {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .panel .entry .t {
        min-width: 0;
      }
      .node .cap,
      .panel .entry .t {
        font-family: var(--wf-font);
      }
    `;

    private props: MapCanvasProps;

    constructor(props: MapCanvasProps) {
      this.props = props;
    }

    render() {
      const { model, theme, onClose } = this.props;
      return html`<div class="map-layout">
        <div class="canvas">
          <button class="back-link" type="button" @click=${onClose}>
            ← Back to the table
          </button>
          ${this.mapBackdrop(model.nodes, theme)}
          ${this.mapPaths(model.nodes, theme)}
          ${model.nodes.map((node) => this.renderNode(node, theme))}
        </div>
        <aside class="panel">${this.renderPanel(model)}</aside>
      </div>`;
    }

    private mapBackdrop(nodes: WayfinderNode[], theme: ExpeditionTheme) {
      return svg`<svg
        viewBox="0 0 1000 660"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        ${drawing.drawBackdrop(nodes, theme, 10, 6.6)}
      </svg>`;
    }

    private mapPaths(nodes: WayfinderNode[], theme: ExpeditionTheme) {
      const accent = THEME_ACCENT[theme];
      return svg`<svg
        viewBox="0 0 1000 660"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g>
          ${drawing.drawFrontier(nodes, 10, 6.6, accent)}
          ${drawing.drawTrail(nodes, 10, 6.6, accent)}
        </g>
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
  }

  return MapCanvas;
}
