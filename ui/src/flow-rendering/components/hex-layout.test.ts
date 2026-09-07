// The pure honeycomb layout math: axial→world conversion, ring walk order,
// compact patch assignment, bounds, and the hexagon box. Tested at the pure
// seam (a named export of the hex-layout module, imported directly as
// TypeScript) with node --test, like the engine's pure-function suites.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  axialToWorld,
  boundsOf,
  HEX_DIRECTIONS,
  hexBox,
  patchCoords,
  patchRadiusForCount,
  ringCapacity,
  ringCoords,
  SQRT3,
} from "../../../../presets/honeycomb/ui/hex-layout.ts";

describe("axialToWorld", () => {
  it("places the origin cell at the origin", () => {
    assert.deepEqual(axialToWorld(0, 0, 46), { x: 0, y: 0 });
  });

  it("uses the pointy-top pitches: √3·s horizontal (row r=0), 1.5·s vertical", () => {
    const east = axialToWorld(1, 0, 46);
    assert.ok(Math.abs(east.x - SQRT3 * 46) < 1e-9);
    assert.equal(east.y, 0);
    const southEast = axialToWorld(0, 1, 46);
    assert.ok(Math.abs(southEast.y - 1.5 * 46) < 1e-9);
    assert.ok(Math.abs(southEast.x - SQRT3 * 46 * 0.5) < 1e-9);
  });

  it("tiles neighbors edge-to-edge: adjacent cells are exactly one hex apart", () => {
    const size = 40;
    const a = axialToWorld(0, 0, size);
    const b = axialToWorld(1, 0, size);
    assert.ok(
      Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - Math.sqrt(3) * size) < 1e-9
    );
  });
});

describe("ringCoords", () => {
  it("returns the origin for radius 0", () => {
    assert.deepEqual(ringCoords(0), [{ q: 0, r: 0 }]);
  });

  it("returns six distinct cells for radius 1, all at hex distance 1", () => {
    const ring = ringCoords(1);
    assert.equal(ring.length, 6);
    assert.equal(new Set(ring.map((c) => `${c.q},${c.r}`)).size, 6);
    for (const coord of ring) {
      const distance =
        (Math.abs(coord.q) + Math.abs(coord.r) + Math.abs(coord.q + coord.r)) /
        2;
      assert.equal(distance, 1);
    }
  });

  it("walks each ring as a closed loop (each cell's successor is a neighbor)", () => {
    const ring = ringCoords(2);
    assert.equal(ring.length, 12);
    const isNeighbor = (
      a: { q: number; r: number },
      b: { q: number; r: number }
    ) => HEX_DIRECTIONS.some((d) => a.q + d.q === b.q && a.r + d.r === b.r);
    for (let i = 0; i < ring.length; i++) {
      const next: { q: number; r: number } = ring[(i + 1) % ring.length];
      assert.ok(isNeighbor(ring[i], next));
    }
  });
});

describe("ringCapacity and patchRadiusForCount", () => {
  it("grows 1, 7, 19, 37", () => {
    assert.equal(ringCapacity(0), 1);
    assert.equal(ringCapacity(1), 7);
    assert.equal(ringCapacity(2), 19);
    assert.equal(ringCapacity(3), 37);
  });

  it("picks the smallest radius that fits", () => {
    assert.equal(patchRadiusForCount(1), 0);
    assert.equal(patchRadiusForCount(7), 1);
    assert.equal(patchRadiusForCount(8), 2);
    assert.equal(patchRadiusForCount(19), 2);
    assert.equal(patchRadiusForCount(20), 3);
  });
});

describe("patchCoords", () => {
  it("assigns contiguous, unique, ring-ordered coordinates", () => {
    for (const count of [1, 5, 12, 19, 25, 40]) {
      const coords = patchCoords(count);
      assert.equal(coords.length, count);
      const keys = new Set(coords.map((c) => `${c.q},${c.r}`));
      assert.equal(keys.size, count);
      const radius = patchRadiusForCount(count);
      const maxDistance = Math.max(
        ...coords.map(
          (c) => (Math.abs(c.q) + Math.abs(c.r) + Math.abs(c.q + c.r)) / 2
        )
      );
      assert.equal(maxDistance, radius);
    }
  });
});

describe("boundsOf", () => {
  it("pads the reach on every side", () => {
    assert.deepEqual(
      boundsOf(
        [
          { x: 0, y: 0 },
          { x: 100, y: 40 },
        ],
        10
      ),
      { minX: -10, minY: -10, maxX: 110, maxY: 50 }
    );
  });

  it("is undefined for no points", () => {
    assert.equal(boundsOf([], 10), undefined);
  });
});

describe("hexBox", () => {
  it("centers a √3·s × 2s box on the hexagon center", () => {
    const box = hexBox({ x: 100, y: 50 }, 40);
    assert.ok(Math.abs(box.width - SQRT3 * 40) < 1e-9);
    assert.equal(box.height, 80);
    assert.ok(Math.abs(box.left - (100 - (SQRT3 * 40) / 2)) < 1e-9);
    assert.equal(box.top, 50 - 40);
  });
});
