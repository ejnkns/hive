/** @public — the shared status-aware wayfinder map visuals: the per-
 * presentation vocabulary (canvas-safe color, glyph, hit radius), the
 * dependency edge visual (satisfied vs unsatisfied), and the pure curved-edge
 * and arrowhead geometry plus the seeded PRNG the backdrops draw from. Both
 * the SVG mini-map (wayfinder-drawing) and the Canvas map surface
 * (map-rendering) read from here, so every status renders the same way in
 * every surface. No DOM, no animation state — pure and testable. */

import type { WayfinderPresentationStatus } from "./wayfinder-map.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";
import { THEME_ACCENT, THEME_GLYPHS } from "./wayfinder-themes.ts";

// The accent statuses take the selected expedition theme's accent color;
// every other status has a fixed canvas-safe color (the DOM overlays can ride
// CSS variables, but the canvas needs concrete fill values). The fixed colors
// mirror the pre-existing mini-map marker palette so the surfaces agree.
const ACCENT_STATUSES: ReadonlySet<WayfinderPresentationStatus> = new Set([
  "frontier",
  "implementation",
  "summit",
]);

const STATUS_COLORS: Record<WayfinderPresentationStatus, string> = {
  base: "#8a93a0",
  fog: "#f0ead9",
  frontier: "#8a93a0", // overridden via ACCENT_STATUSES
  blocked: "#d0b3b3",
  active: "#d29922",
  decision: "#3fb950",
  "out-of-scope": "#9aa4ad",
  implementation: "#8a93a0", // overridden via ACCENT_STATUSES
  summit: "#8a93a0", // overridden via ACCENT_STATUSES
};

/** The canvas-safe fill color for a presentation status under a theme. */
export function nodeStatusColor(
  presentation: WayfinderPresentationStatus,
  theme: ExpeditionTheme
): string {
  if (ACCENT_STATUSES.has(presentation)) return THEME_ACCENT[theme];
  return STATUS_COLORS[presentation];
}

/** The single-codepoint glyph for a presentation ("" for the CSS-dot
 * statuses — frontier/blocked/active render as coloured dots, fog as its own
 * question mark). */
export function nodeStatusGlyph(
  presentation: WayfinderPresentationStatus,
  theme: ExpeditionTheme
): string {
  switch (presentation) {
    case "summit":
      return THEME_GLYPHS[theme].summit;
    case "base":
      return THEME_GLYPHS[theme].base;
    case "decision":
      return THEME_GLYPHS[theme].decision;
    case "implementation":
      return THEME_GLYPHS[theme].implementation;
    case "out-of-scope":
      return THEME_GLYPHS[theme].outOfScope;
    default:
      return "";
  }
}

/** The marker radius for a presentation — the fog node reads larger than the
 * content dots, and the radius doubles as the base hit tolerance. */
export function nodeStatusRadius(
  presentation: WayfinderPresentationStatus
): number {
  return presentation === "fog" ? 5 : 4;
}

/** How a dependency edge draws: a satisfied edge (blocker closed) is solid
 * and bright in the theme accent; an unsatisfied edge is a faint dashed
 * thread. The arrowhead shares the stroke, slightly more opaque. */
export type EdgeVisual = {
  stroke: string;
  width: number;
  dash: readonly number[];
  alpha: number;
  arrowAlpha: number;
};

export function edgeVisual(
  satisfied: boolean,
  theme: ExpeditionTheme
): EdgeVisual {
  if (satisfied) {
    return {
      stroke: THEME_ACCENT[theme],
      width: 1.8,
      dash: [],
      alpha: 0.62,
      arrowAlpha: 0.95,
    };
  }
  return {
    stroke: "#8a93a0",
    width: 1.3,
    dash: [4, 6],
    alpha: 0.32,
    arrowAlpha: 0.7,
  };
}

/** The geometry of one curved dependency edge: endpoints, the quadratic
 * control point bowed perpendicular to the segment (capped by length), the
 * curve midpoint B(0.5), and the unit tangent from blocker to dependent. */
export type EdgeCurve = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  midX: number;
  midY: number;
  ux: number;
  uy: number;
};

export function edgeCurve(
  ax: number,
  ay: number,
  bx: number,
  by: number
): EdgeCurve {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = Math.min(46, len * 0.13);
  const cx = mx + nx * bow;
  const cy = my + ny * bow;
  return {
    ax,
    ay,
    bx,
    by,
    cx,
    cy,
    midX: 0.25 * ax + 0.5 * cx + 0.25 * bx,
    midY: 0.25 * ay + 0.5 * cy + 0.25 * by,
    ux: dx / len,
    uy: dy / len,
  };
}

/** The arrowhead triangle centred on the curve midpoint: the tip sits half a
 * head-length ahead of the midpoint along the tangent, the base half behind,
 * with the base corners offset along the perpendicular — so direction reads
 * without crowding either vertex. */
export type ArrowheadPoints = {
  tip: { x: number; y: number };
  left: { x: number; y: number };
  right: { x: number; y: number };
};

export function arrowheadPoints(
  midX: number,
  midY: number,
  ux: number,
  uy: number,
  ah = 7,
  aw = 3.8
): ArrowheadPoints {
  const px = -uy;
  const py = ux;
  const tipX = midX + ux * (ah * 0.5);
  const tipY = midY + uy * (ah * 0.5);
  const leftX = tipX - ux * ah + px * aw;
  const leftY = tipY - uy * ah + py * aw;
  const rightX = tipX - ux * ah - px * aw;
  const rightY = tipY - uy * ah - py * aw;
  return {
    tip: { x: tipX, y: tipY },
    left: { x: leftX, y: leftY },
    right: { x: rightX, y: rightY },
  };
}

/** The wobbled-contour points both the SVG mini-map path and the Canvas
 * terrain trace — a slightly perturbed ellipse that reads as hand-surveyed
 * terrain. Deterministic per seed. */
export function wobblePoints(
  cx: number,
  cy: number,
  r: number,
  seed: number
): Array<{ x: number; y: number }> {
  const n = 60;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const rr =
      r +
      Math.sin(a * 5 + seed) * r * 0.08 +
      Math.sin(a * 9 + seed * 2) * r * 0.04;
    points.push({
      x: cx + Math.cos(a) * rr,
      y: cy + Math.sin(a) * rr * 0.82,
    });
  }
  return points;
}

/** mulberry32 — a tiny deterministic PRNG for the starfield and contour
 * placement (the reference implementation). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
