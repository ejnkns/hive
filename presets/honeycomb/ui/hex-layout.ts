/** @public — the pure honeycomb hex-grid layout: pointy-top axial hexagon
 * math, the edge-to-edge honeycomb tiling cells sit on, compact ring-fill
 * assignment of a category's cells into a patch, the overview hive lattice,
 * and camera fitting. No DOM, no entries knowledge — the derivation
 * (honeycomb-map.ts) feeds it categories and counts. Pure so every constant
 * the surface renders with is testable without a browser. */

// The axial coordinate on the hex grid.
export type Axial = { q: number; r: number };

// A world position in pixels.
export type WorldPoint = { x: number; y: number };

// The default cell circumradius, in world pixels: a cell is 2s wide and
// √3·s tall, comfortably fitting a four-line title at s = 58.
export const CELL_SCALE = 58;

// The minimum hive lattice scale (the overview spacing between hive
// centers, in world pixels). One cell of visual separation between
// neighboring single-cell hives is the floor; the derivation grows it to
// keep large patches from touching.
export const MIN_HIVE_SCALE = CELL_SCALE * 5;

// The breathing room between neighboring patches, in world pixels.
export const PATCH_GAP = CELL_SCALE * 2;

// √3, the horizontal pitch factor of a pointy-top hex grid.
export const SQRT3 = Math.sqrt(3);

/** Axial hex coordinates → world pixels (flat-top orientation — flat
 * edges on top and bottom, points left and right): x = s·1.5·q,
 * y = s·√3·(q/2 + r). Neighbors tile edge-to-edge — the honeycomb. */
export function axialToWorld(q: number, r: number, size: number): WorldPoint {
  return { x: size * 1.5 * q, y: size * SQRT3 * (q / 2 + r) };
}

/** The six axial neighbor directions, clockwise from east. */
export const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** The axial coordinates of the ring at hex distance `radius` from the
 * origin, in walk order (six directions × `radius` steps). Radius 0 is the
 * origin cell itself. */
export function ringCoords(radius: number): Axial[] {
  if (radius <= 0) return [{ q: 0, r: 0 }];
  const coords: Axial[] = [];
  // Walk out along direction 4 (the south-west diagonal) to the ring start,
  // then walk the six sides.
  let q = HEX_DIRECTIONS[4].q * radius;
  let r = HEX_DIRECTIONS[4].r * radius;
  for (const direction of HEX_DIRECTIONS) {
    for (let step = 0; step < radius; step++) {
      coords.push({ q, r });
      q += direction.q;
      r += direction.r;
    }
  }
  return coords;
}

/** The number of axial coordinates in rings 0..radius (1, 7, 19, 37…). */
export function ringCapacity(radius: number): number {
  return radius <= 0 ? 1 : 1 + (6 * (radius * (radius + 1))) / 2;
}

/** The ring depth needed to hold `count` cells in a compact hex-shaped
 * patch: the smallest radius whose ring capacity reaches the count. */
export function patchRadiusForCount(count: number): number {
  let radius = 0;
  while (ringCapacity(radius) < count) radius += 1;
  return radius;
}

/** The first `count` coordinates of the compact ring fill — rings 0..R in
 * walk order, so a patch is always a contiguous hex-shaped blob of the
 * honeycomb tiling, growing ring by ring as ideas land. */
export function patchCoords(count: number): Axial[] {
  const radius = patchRadiusForCount(count);
  const coords: Axial[] = [];
  for (let ring = 0; ring <= radius && coords.length < count; ring++) {
    for (const coord of ringCoords(ring)) {
      if (coords.length >= count) break;
      coords.push(coord);
    }
  }
  return coords;
}

/** The world-space bounds of a set of positions with `reach` of corner
 * overhang (a hexagon's corners reach `size` beyond the center's bounding
 * logic — the caller passes the reach it wants padded). */
export function boundsOf(
  points: readonly WorldPoint[],
  reach: number
): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  if (points.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x - reach);
    minY = Math.min(minY, point.y - reach);
    maxX = Math.max(maxX, point.x + reach);
    maxY = Math.max(maxY, point.y + reach);
  }
  return { minX, minY, maxX, maxY };
}

/** The bounding box of one hexagon of circumradius `size`, centered on the
 * given world point: the left/top/width/height its element needs. Flat-top:
 * the box is 2s wide by √3·s tall. */
export function hexBox(
  center: WorldPoint,
  size: number
): { left: number; top: number; width: number; height: number } {
  return {
    left: center.x - size,
    top: center.y - (SQRT3 * size) / 2,
    width: 2 * size,
    height: SQRT3 * size,
  };
}
