/** The wayfinder SVG drawing builders (module-set sibling of the served flow
 * component): the pure geometry (peak/wobble/trail path data) and the shared
 * draw methods the mini-map and the full expedition map both use. Nothing
 * reads component state — the svg/nothing tags arrive through the lit deps
 * factory and every theme-dependent draw takes the theme as a parameter — so
 * the module stays pure and testable. */

import type { FlowComponentDeps } from "workflow-engine/workflow-types";
import type { WayfinderNode } from "./wayfinder-map.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";
import { THEME_ACCENT } from "./wayfinder-themes.ts";

// A triangle peak path (apex at x,y; base at y+height).
export function peak(
  x: number,
  y: number,
  halfWidth: number,
  height: number
): string {
  return `M ${x - halfWidth} ${y + height} L ${x} ${y} L ${x + halfWidth} ${
    y + height
  } Z`;
}

// An organic contour ring (a slightly wobbled ellipse) — the topo theme's
// contour lines, drawn from a small number of perturbed radii so they read as
// hand-surveyed terrain rather than perfect circles.
export function wobblePath(
  cx: number,
  cy: number,
  r: number,
  seed: number
): string {
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
export function trailNodes(nodes: WayfinderNode[]): WayfinderNode[] {
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

// Optional interactivity for a marker circle: the mini-map wires these from
// the entry's hover/focus state so the drawing builders stay pure.
export type MarkerInteractions = {
  className?: string;
  onEnter?: () => void;
  onLeave?: () => void;
  onClick?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeydown?: (event: KeyboardEvent) => void;
};

// Binds the svg/nothing template tags once and returns the shared draw
// methods. Theme-dependent methods take the theme as a parameter — the entry
// and the map view both call these, so component state never leaks in.
export function createWayfinderDrawing(deps: FlowComponentDeps) {
  const { svg, nothing } = deps;
  return {
    drawBackdrop(
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
    },

    drawFrontier(
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
    },

    drawTrail(nodes: WayfinderNode[], sx: number, sy: number, accent: string) {
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
    },

    drawMarker(
      node: WayfinderNode,
      sx: number,
      sy: number,
      theme: ExpeditionTheme,
      interactions: MarkerInteractions = {}
    ) {
      const colors: Record<string, string> = {
        decision: "#3fb950",
        implementation: THEME_ACCENT[theme],
        ready: THEME_ACCENT[theme],
        resolving: "#d29922",
        fog: "#f0ead9",
        "out-of-scope": "#9aa4ad",
      };
      const fill = colors[node.kind] ?? "#9aa4ad";
      const radius = node.kind === "fog" ? 5 : 4;
      const isFog = node.kind === "fog";
      const interactive = interactions.onClick !== undefined;
      return svg`<circle
        cx=${node.x * sx}
        cy=${node.y * sy}
        r=${radius}
        fill=${isFog ? "none" : fill}
        stroke=${isFog ? "#f0ead9" : "none"}
        stroke-width=${isFog ? "1.6" : "0"}
        data-id=${node.id}
        class=${interactions.className ?? "marker"}
        tabindex=${interactive ? "0" : undefined}
        @mouseenter=${interactions.onEnter}
        @mouseleave=${interactions.onLeave}
        @click=${interactions.onClick}
        @focus=${interactions.onFocus}
        @blur=${interactions.onBlur}
        @keydown=${interactions.onKeydown}
      ></circle>`;
    },
  };
}
