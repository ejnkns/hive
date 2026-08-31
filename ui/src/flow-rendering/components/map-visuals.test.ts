// The wayfinder shared map visuals: the status-aware vocabulary (color, glyph,
// radius per presentation status), the edge visuals (satisfied vs unsatisfied
// dependency), and the pure curved-edge + arrowhead geometry both the SVG
// mini-map and the Canvas map surface draw from. Tested at the pure seam so
// every surface renders every status the same way.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  arrowheadPoints,
  edgeCurve,
  edgeVisual,
  nodeStatusColor,
  nodeStatusGlyph,
  nodeStatusRadius,
  seededRandom,
} from "../../../../presets/wayfinder/ui/map-visuals.ts";

describe("node status visuals", () => {
  it("colors every presentation status with its canonical color", () => {
    assert.equal(nodeStatusColor("decision", "mountain"), "#3fb950");
    assert.equal(nodeStatusColor("blocked", "mountain"), "#d0b3b3");
    assert.equal(nodeStatusColor("active", "mountain"), "#d29922");
    assert.equal(nodeStatusColor("fog", "mountain"), "#f0ead9");
    assert.equal(nodeStatusColor("out-of-scope", "mountain"), "#9aa4ad");
    // The accent statuses follow the selected theme's accent.
    assert.equal(nodeStatusColor("frontier", "mountain"), "#4a9fe0");
    assert.equal(nodeStatusColor("frontier", "topo"), "#58a06a");
    assert.equal(nodeStatusColor("frontier", "stars"), "#5bc0e8");
    assert.equal(nodeStatusColor("summit", "stars"), "#5bc0e8");
    assert.equal(nodeStatusColor("implementation", "topo"), "#58a06a");
  });

  it("maps each presentation to its glyph (or none for the dot statuses)", () => {
    assert.equal(nodeStatusGlyph("summit", "mountain"), "▲");
    assert.equal(nodeStatusGlyph("summit", "topo"), "◉");
    assert.equal(nodeStatusGlyph("summit", "stars"), "◉");
    assert.equal(nodeStatusGlyph("base", "mountain"), "⌂");
    assert.equal(nodeStatusGlyph("decision", "mountain"), "▴");
    assert.equal(nodeStatusGlyph("implementation", "stars"), "◍");
    assert.equal(nodeStatusGlyph("out-of-scope", "mountain"), "⊘");
    // Frontier/blocked/active/fog are CSS dots or the fog question mark —
    // no glyph character.
    assert.equal(nodeStatusGlyph("frontier", "stars"), "");
    assert.equal(nodeStatusGlyph("blocked", "stars"), "");
    assert.equal(nodeStatusGlyph("active", "stars"), "");
    assert.equal(nodeStatusGlyph("fog", "stars"), "");
  });

  it("sizes fog nodes larger than the content dots (hit tolerance)", () => {
    assert.equal(nodeStatusRadius("fog"), 5);
    assert.equal(nodeStatusRadius("frontier"), 4);
    assert.equal(nodeStatusRadius("decision"), 4);
    assert.equal(nodeStatusRadius("blocked"), 4);
  });
});

describe("edge visuals", () => {
  it("draws a satisfied dependency solid and bright, an unsatisfied one dashed and dim", () => {
    const satisfied = edgeVisual(true, "mountain");
    assert.equal(satisfied.stroke, "#4a9fe0");
    assert.deepEqual(satisfied.dash, []);
    assert.ok(satisfied.alpha > 0.5);
    const unsatisfied = edgeVisual(false, "mountain");
    assert.deepEqual(unsatisfied.dash, [4, 6]);
    assert.ok(unsatisfied.alpha < satisfied.alpha);
    assert.ok(unsatisfied.width < satisfied.width);
  });

  it("keys satisfied edges to the theme accent", () => {
    assert.equal(edgeVisual(true, "topo").stroke, "#58a06a");
    assert.equal(edgeVisual(true, "stars").stroke, "#5bc0e8");
  });
});

describe("edge curve geometry", () => {
  it("bows the curve perpendicular to the segment, capped by length", () => {
    const curve = edgeCurve(0, 0, 100, 0);
    // Midpoint (50, 0); the perpendicular (0,1) direction bows it up.
    assert.equal(curve.cx, 50);
    assert.ok(curve.cy > 0);
    // Bow is capped: a very long edge bows at most the cap, a short edge bows
    // a fraction of its length.
    const long = edgeCurve(0, 0, 10000, 0);
    const short = edgeCurve(0, 0, 10, 0);
    assert.equal(long.cy, 46); // the cap
    assert.ok(short.cy < 10);
  });

  it("places the curve midpoint at B(0.5) of the quadratic bezier", () => {
    const curve = edgeCurve(0, 0, 100, 0);
    // B(0.5) = 0.25a + 0.5c + 0.25b.
    assert.equal(curve.midX, 0.25 * 0 + 0.5 * curve.cx + 0.25 * 100);
    assert.equal(curve.midY, 0.25 * 0 + 0.5 * curve.cy + 0.25 * 0);
  });

  it("orients the unit tangent from the blocker toward the dependent", () => {
    const curve = edgeCurve(10, 10, 30, 20);
    assert.ok(Math.abs(curve.ux - 0.8944271909999159) < 1e-9);
    assert.ok(Math.abs(curve.uy - 0.4472135954999579) < 1e-9);
  });

  it("guards a zero-length edge (overlapping positions)", () => {
    const curve = edgeCurve(5, 5, 5, 5);
    // No NaN/Infinity escapes; the bow collapses onto the shared point.
    assert.ok(Number.isFinite(curve.cx));
    assert.ok(Number.isFinite(curve.cy));
    assert.equal(curve.cx, 5);
    assert.equal(curve.cy, 5);
  });

  it("builds a symmetric arrowhead straddling the midpoint, pointing along the tangent", () => {
    const curve = edgeCurve(0, 0, 100, 0);
    const head = arrowheadPoints(curve.midX, curve.midY, curve.ux, curve.uy);
    // Tip sits ahead of the midpoint along the tangent.
    assert.ok(head.tip.x > curve.midX);
    assert.ok(Math.abs(head.tip.y - curve.midY) < 1e-9);
    // Left/right base corners mirror across the tangent line.
    assert.ok(Math.abs(head.left.x - head.right.x) < 1e-9);
    assert.ok(Math.abs(head.left.y + head.right.y - 2 * head.tip.y) < 1e-9);
  });
});

describe("seeded randomness", () => {
  it("is deterministic per seed and distinct across seeds", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(43);
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
    assert.notDeepEqual([c(), c()], [a(), a()]);
  });
});
