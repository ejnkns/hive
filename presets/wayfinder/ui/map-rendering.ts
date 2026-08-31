/** @public — the Canvas map-surface rendering primitives: the theme backdrop
 * decorations (parallax starfield, mountain peaks, topo contours and
 * graticule) and the curved dependency edges with arrowheads, drawn from the
 * shared map model and layout through the same camera the controller
 * positions DOM overlays with. The draw functions take a 2d context (a
 * browser boundary, and the reason this module is verified by eye in a real
 * browser rather than in jsdom), so the pure geometry they use — edge curves,
 * arrowheads, wobble contours, the PRNG — lives in map-visuals and is tested
 * there. */

import type { MapCamera, MapViewport } from "./map-camera.ts";
import {
  arrowheadPoints,
  edgeCurve,
  edgeVisual,
  seededRandom,
  wobblePoints,
} from "./map-visuals.ts";
import type {
  WayfinderLayoutBounds,
  WayfinderPosition,
} from "./wayfinder-layout.ts";
import type { WayfinderMap } from "./wayfinder-map.ts";
import type { ExpeditionTheme } from "./wayfinder-themes.ts";

/** Everything a frame's draw needs: the 2d context, the current camera and
 * viewport (the same transform the controller positions DOM overlays with),
 * the layout bounds (the topo graticule extent), the theme, the shared model,
 * the layout positions, the elapsed seconds (star twinkle), and the resolved
 * star fill color. */
export type MapSurfaceRender = {
  ctx: CanvasRenderingContext2D;
  camera: MapCamera;
  viewport: MapViewport;
  bounds: WayfinderLayoutBounds;
  theme: ExpeditionTheme;
  map: WayfinderMap;
  positions: ReadonlyMap<string, WayfinderPosition>;
  time: number;
  starColor: string;
};

/** Draw one frame: the starfield in screen space (parallax, never fading with
 * the camera), then the terrain decorations and dependency edges in world
 * space under the camera transform. */
export function renderMapSurface(render: MapSurfaceRender): void {
  const { ctx } = render;
  ctx.save();
  drawStarfield(render);
  ctx.translate(render.camera.x, render.camera.y);
  ctx.scale(render.camera.scale, render.camera.scale);
  drawTerrain(render);
  drawEdges(render);
  ctx.restore();
}

// The starfield layers: three parallax depths (closer layers drift faster
// with the camera and draw larger, brighter stars).
const STAR_LAYER_SPECS = [
  { factor: 0.15, count: 140, size: 0.7, alpha: 0.45 },
  { factor: 0.3, count: 80, size: 1.1, alpha: 0.65 },
  { factor: 0.5, count: 34, size: 1.7, alpha: 0.9 },
];

// The deterministic starfield, computed once: every star is a unit-square
// position plus a twinkle phase, seeded so the same map always draws the same
// sky.
let starLayerCache:
  | Array<Array<{ x: number; y: number; phase: number }>>
  | undefined;

function starLayers(): Array<Array<{ x: number; y: number; phase: number }>> {
  if (starLayerCache === undefined) {
    const random = seededRandom(9001);
    starLayerCache = STAR_LAYER_SPECS.map((spec) =>
      Array.from({ length: spec.count }, () => ({
        x: random(),
        y: random(),
        phase: random(),
      }))
    );
  }
  return starLayerCache;
}

function drawStarfield({
  ctx,
  camera,
  viewport,
  time,
  starColor,
}: MapSurfaceRender): void {
  const layers = starLayers();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const spec = STAR_LAYER_SPECS[layerIndex];
    const layer = layers[layerIndex];
    ctx.fillStyle = starColor;
    for (const star of layer) {
      // The layer drifts with the camera at its parallax factor and wraps
      // around the viewport, so panning never reveals an edge.
      const x = mod(
        star.x * viewport.width + camera.x * spec.factor,
        viewport.width
      );
      const y = mod(
        star.y * viewport.height + camera.y * spec.factor,
        viewport.height
      );
      const twinkle = 0.65 + 0.35 * Math.sin(time * 6.283 + star.phase * 6.283);
      ctx.globalAlpha = spec.alpha * twinkle;
      ctx.fillRect(x, y, spec.size, spec.size);
    }
  }
  ctx.globalAlpha = 1;
}

function drawTerrain(render: MapSurfaceRender): void {
  if (render.theme === "mountain") drawMountainTerrain(render);
  else if (render.theme === "topo") drawTopoTerrain(render);
  else drawStarsSun(render);
}

// The mountain theme's terrain: a summit peak plus one peak per conquered
// node (decision/implementation), filled in the theme's survey blue.
function drawMountainTerrain({ ctx, map, positions }: MapSurfaceRender): void {
  const summit = positions.get("summit");
  if (summit !== undefined) {
    fillPeak(ctx, summit.x, summit.y, 60, 120, "rgba(74,159,224,.15)");
  }
  for (const node of map.nodes) {
    if (
      node.presentation !== "decision" &&
      node.presentation !== "implementation"
    ) {
      continue;
    }
    const position = positions.get(node.id);
    if (position === undefined) continue;
    fillPeak(ctx, position.x, position.y, 16, 30, "rgba(74,159,224,.12)");
  }
}

function fillPeak(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  halfWidth: number,
  height: number,
  fill: string
): void {
  ctx.beginPath();
  ctx.moveTo(x - halfWidth, y + height);
  ctx.lineTo(x, y);
  ctx.lineTo(x + halfWidth, y + height);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// The topo theme's terrain: a survey graticule over the layout bounds and
// wobbled contour rings around the summit and each conquered node.
function drawTopoTerrain({
  ctx,
  bounds,
  map,
  positions,
}: MapSurfaceRender): void {
  ctx.strokeStyle = "rgba(255,255,255,.04)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const startX = Math.floor(bounds.minX / 100) * 100;
  const endX = Math.ceil(bounds.maxX / 100) * 100;
  for (let x = startX; x <= endX; x += 100) {
    ctx.moveTo(x, bounds.minY);
    ctx.lineTo(x, bounds.maxY);
  }
  const startY = Math.floor(bounds.minY / 100) * 100;
  const endY = Math.ceil(bounds.maxY / 100) * 100;
  for (let y = startY; y <= endY; y += 100) {
    ctx.moveTo(bounds.minX, y);
    ctx.lineTo(bounds.maxX, y);
  }
  ctx.stroke();

  const summit = positions.get("summit");
  if (summit !== undefined) {
    for (let i = 0; i < 5; i += 1) {
      traceWobble(
        ctx,
        summit.x,
        summit.y,
        46 + i * 34,
        i,
        `rgba(88,160,106,${(0.12 + i * 0.035).toFixed(3)})`
      );
    }
  }
  let conqueredIndex = 0;
  for (const node of map.nodes) {
    if (
      node.presentation !== "decision" &&
      node.presentation !== "implementation"
    ) {
      continue;
    }
    const position = positions.get(node.id);
    if (position === undefined) continue;
    traceWobble(
      ctx,
      position.x,
      position.y,
      18,
      position.x + position.y + conqueredIndex,
      "rgba(88,160,106,.3)"
    );
    conqueredIndex += 1;
  }
}

function traceWobble(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
  stroke: string
): void {
  ctx.beginPath();
  wobblePoints(cx, cy, r, seed).forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// The stars theme's sun: a soft glow around the summit — the destination is
// the system's sun, exactly as the SVG backdrop drew it.
function drawStarsSun({ ctx, positions }: MapSurfaceRender): void {
  const summit = positions.get("summit");
  if (summit === undefined) return;
  const glow = ctx.createRadialGradient(
    summit.x,
    summit.y,
    0,
    summit.x,
    summit.y,
    26
  );
  glow.addColorStop(0, "rgba(91,192,232,.22)");
  glow.addColorStop(1, "rgba(91,192,232,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(summit.x, summit.y, 26, 0, Math.PI * 2);
  ctx.fill();
}

// The dependency edges: a curved line from blocker to dependent with an
// arrowhead at the curve midpoint, satisfied edges solid and bright,
// unsatisfied edges a faint dashed thread.
function drawEdges({ ctx, theme, map, positions }: MapSurfaceRender): void {
  for (const edge of map.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const curve = edgeCurve(from.x, from.y, to.x, to.y);
    const visual = edgeVisual(edge.satisfied, theme);
    ctx.strokeStyle = visual.stroke;
    ctx.globalAlpha = visual.alpha;
    ctx.lineWidth = visual.width;
    ctx.setLineDash([...visual.dash]);
    ctx.beginPath();
    ctx.moveTo(curve.ax, curve.ay);
    ctx.quadraticCurveTo(curve.cx, curve.cy, curve.bx, curve.by);
    ctx.stroke();
    ctx.setLineDash([]);
    const head = arrowheadPoints(curve.midX, curve.midY, curve.ux, curve.uy);
    ctx.globalAlpha = visual.arrowAlpha;
    ctx.fillStyle = visual.stroke;
    ctx.beginPath();
    ctx.moveTo(head.tip.x, head.tip.y);
    ctx.lineTo(head.left.x, head.left.y);
    ctx.lineTo(head.right.x, head.right.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Positive modulo for the starfield wrap.
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
