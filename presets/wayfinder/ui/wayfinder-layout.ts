/** The wayfinder deterministic spatial layout (module-set sibling of the
 * served flow component): pure rank-biased placement of the derived map
 * model into world coordinates, so the map controller can fit the camera to
 * the result without this module ever reading DOM state, owning animation,
 * or persisting positions anywhere.
 *
 * Layout is a force simulation soft-pulled toward a radius set by each
 * node's dependency rank (longest blocker chain from a root): blockers drift
 * inward, deeper dependents outward, with the synthetic summit anchored at
 * the outermost ring and base camp pinned at the origin. Dependency
 * direction therefore stays legible radially without strict columns or
 * rings. Everything is seeded from node/edge identity — never array order —
 * so the same snapshot lays out the same way on every load and every node
 * ordering, and a ticket stays where you learned it. */

import type {
  WayfinderEdge,
  WayfinderMap,
  WayfinderNode,
} from "./wayfinder-map.ts";

/** A world-coordinate position for one node id. */
export type WayfinderPosition = { x: number; y: number };

/** The padded rectangle around a laid-out map — the input the map
 * controller's camera fit needs. */
export type WayfinderLayoutBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** The default breathing room around the constellation, from the reference
 * camera fit. */
const LAYOUT_BOUNDS_PAD = 70;

/** Two pi, spelled out once for the placement math. */
const TAU = Math.PI * 2;

// The simulation constants, carried over from the reference layout: nodes
// repel pairwise, connected nodes spring toward a rest length, and every
// node is radially pulled toward the ring its rank owns.
const RING_BASE = 130;
const RING_GAP = 165;
const REPULSION = 9000;
const SPRING = 0.02;
const SPRING_REST = 150;
const RADIAL = 0.05;
const INITIAL_ITERATIONS = 420;
const WARM_ITERATIONS = 200;
const PLACEMENT_JITTER = 70;
/** The distance a freshly added node seeds from its pinned neighbour. */
const WARM_SEED_ORBIT = 120;

/** The radius a node's rank owns: roots near the core, deeper dependencies
 * further out. */
function ringRadius(rank: number): number {
  return RING_BASE + rank * RING_GAP;
}

/** mulberry32 — a tiny deterministic PRNG (the reference implementation). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit FNV-1a hash over the given strings, in order. */
function hashStrings(strings: readonly string[]): number {
  let hash = 2166136261;
  for (const value of strings) {
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The deterministic seed for a snapshot, derived from node and edge
 * identity — not from array order, so the same map seeds the same way
 * regardless of how its nodes and edges happen to be ordered. */
function identitySeed(
  nodes: readonly WayfinderNode[],
  edgeIds: readonly string[]
): number {
  const material = [
    ...nodes.map((node) => node.id).sort(),
    ...[...edgeIds].sort(),
  ];
  return hashStrings(material);
}

/** The dependency rank of every node: the longest chain of in-snapshot
 * blockers from a node with none, relaxed to a fixpoint (bounded by the
 * node count, so even a malformed dependency cycle cannot loop forever).
 * The synthetic summit is lifted to the outermost rank so the whole map
 * leads toward it. */
function dependencyRanks(nodes: readonly WayfinderNode[]): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const blockersOf = new Map<string, string[]>();
  for (const node of nodes) {
    blockersOf.set(
      node.id,
      node.blockers.filter((blockerId) => ids.has(blockerId))
    );
  }
  const ranks = new Map<string, number>();
  for (const node of nodes) ranks.set(node.id, 0);
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const node of nodes) {
      let rank = 0;
      for (const blockerId of blockersOf.get(node.id) ?? []) {
        rank = Math.max(rank, (ranks.get(blockerId) ?? 0) + 1);
      }
      if (rank > (ranks.get(node.id) ?? 0)) {
        ranks.set(node.id, rank);
        changed = true;
      }
    }
    if (!changed) break;
  }
  let deepest = 0;
  for (const [id, rank] of ranks) {
    if (id !== "summit" && rank > deepest) deepest = rank;
  }
  if (ranks.has("summit")) ranks.set("summit", deepest + 1);
  return ranks;
}

/** The nodes and edges of a snapshot in canonical (id-sorted) order, so
 * every downstream pass — PRNG draws, pairwise forces, edge springs —
 * consumes the snapshot identically no matter how the model happened to
 * order its arrays. */
function canonicalNodes(nodes: readonly WayfinderNode[]): WayfinderNode[] {
  return [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Lay the map out from scratch: every node receives a deterministic
 * world-coordinate position derived from its identity and dependency rank.
 * The synthetic base camp is pinned at the origin; every other node is
 * placed on its rank ring with identity-seeded jitter, then relaxed under
 * pairwise repulsion, edge springs, and the radial rank pull. */
export function layoutWayfinderMap(
  map: WayfinderMap
): Map<string, WayfinderPosition> {
  const nodes = canonicalNodes(map.nodes);
  const edges = canonicalEdges(map.edges);
  const positions = new Map<string, WayfinderPosition>();
  if (nodes.length === 0) return positions;

  const ranks = dependencyRanks(nodes);
  const random = mulberry32(
    identitySeed(
      nodes,
      edges.map((edge) => edge.id)
    )
  );

  for (const node of nodes) {
    if (node.id === "base") {
      positions.set(node.id, { x: 0, y: 0 });
      continue;
    }
    const angle = random() * TAU;
    const jitter = (random() - 0.5) * PLACEMENT_JITTER;
    const radius = ringRadius(ranks.get(node.id) ?? 0) + jitter;
    positions.set(node.id, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }

  relax(nodes, edges, positions, ranks, INITIAL_ITERATIONS, new Set(["base"]));
  return positions;
}

/** Edges in canonical (id-sorted) order — see canonicalNodes. */
function canonicalEdges(edges: readonly WayfinderEdge[]): WayfinderEdge[] {
  return [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Lay an updated snapshot out without disturbing the constellation: every
 * node id present in `previousPositions` keeps exactly that position and is
 * pinned for the whole relaxation; only newly added nodes move. A new node
 * with a pinned neighbour (blocker or dependent) seeds on an orbit around
 * it; an unrelated new node seeds around its own rank ring. Survivors move
 * exactly zero, so spatial memory survives every live update. */
export function layoutWayfinderMapWarm(
  map: WayfinderMap,
  previousPositions: ReadonlyMap<string, WayfinderPosition>
): Map<string, WayfinderPosition> {
  const nodes = canonicalNodes(map.nodes);
  const edges = canonicalEdges(map.edges);
  const positions = new Map<string, WayfinderPosition>();
  const fresh: WayfinderNode[] = [];

  for (const node of nodes) {
    const previous = previousPositions.get(node.id);
    if (previous === undefined) fresh.push(node);
    else positions.set(node.id, { x: previous.x, y: previous.y });
  }
  if (fresh.length === 0) return positions;

  const ranks = dependencyRanks(nodes);
  const random = mulberry32(
    identitySeed(
      fresh,
      edges.map((edge) => edge.id)
    )
  );
  const pinned = new Set(positions.keys());

  for (const node of fresh) {
    const anchor = pinnedAnchor(node, edges, positions, pinned);
    const angle = random() * TAU;
    const radius =
      anchor === undefined
        ? ringRadius(ranks.get(node.id) ?? 0)
        : WARM_SEED_ORBIT;
    const centerX = anchor?.x ?? 0;
    const centerY = anchor?.y ?? 0;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  }

  relax(nodes, edges, positions, ranks, WARM_ITERATIONS, pinned);
  return positions;
}

/** The first pinned neighbour of a fresh node in canonical edge order —
 * its blocker if that is already on screen, otherwise a dependent — so the
 * new node flies in next to the node that relates to it. Neighbours that
 * are themselves fresh are skipped, so the anchor is always a node that
 * actually holds still. */
function pinnedAnchor(
  node: WayfinderNode,
  edges: readonly WayfinderEdge[],
  positions: ReadonlyMap<string, WayfinderPosition>,
  pinned: ReadonlySet<string>
): WayfinderPosition | undefined {
  for (const edge of edges) {
    if (edge.to === node.id && pinned.has(edge.from)) {
      const anchor = positions.get(edge.from);
      if (anchor !== undefined) return anchor;
    }
    if (edge.from === node.id && pinned.has(edge.to)) {
      const anchor = positions.get(edge.to);
      if (anchor !== undefined) return anchor;
    }
  }
  return undefined;
}

// The shared relaxation pass: pairwise repulsion, edge springs toward the
// rest length, and the radial pull toward each node's rank ring. Pinned ids
// (anchored nodes, or every survivor during a warm update) never move.
function relax(
  nodes: readonly WayfinderNode[],
  edges: readonly WayfinderEdge[],
  positions: Map<string, WayfinderPosition>,
  ranks: Map<string, number>,
  iterations: number,
  pinned: ReadonlySet<string>
): void {
  for (let step = 0; step < iterations; step++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const aPosition = positions.get(a.id);
      if (aPosition === undefined) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const bPosition = positions.get(b.id);
        if (bPosition === undefined) continue;
        const dx = aPosition.x - bPosition.x;
        const dy = aPosition.y - bPosition.y;
        const distanceSquared = dx * dx + dy * dy || 0.01;
        const distance = Math.sqrt(distanceSquared);
        const force = REPULSION / distanceSquared;
        const ux = dx / distance;
        const uy = dy / distance;
        if (!pinned.has(a.id)) {
          aPosition.x += ux * force;
          aPosition.y += uy * force;
        }
        if (!pinned.has(b.id)) {
          bPosition.x -= ux * force;
          bPosition.y -= uy * force;
        }
      }
    }

    for (const edge of edges) {
      const aPosition = positions.get(edge.from);
      const bPosition = positions.get(edge.to);
      if (aPosition === undefined || bPosition === undefined) continue;
      const dx = bPosition.x - aPosition.x;
      const dy = bPosition.y - aPosition.y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const force = (distance - SPRING_REST) * SPRING;
      const ux = dx / distance;
      const uy = dy / distance;
      if (!pinned.has(edge.from)) {
        aPosition.x += ux * force;
        aPosition.y += uy * force;
      }
      if (!pinned.has(edge.to)) {
        bPosition.x -= ux * force;
        bPosition.y -= uy * force;
      }
    }

    for (const node of nodes) {
      if (pinned.has(node.id)) continue;
      const position = positions.get(node.id);
      if (position === undefined) continue;
      const distance = Math.hypot(position.x, position.y) || 0.01;
      const target = ringRadius(ranks.get(node.id) ?? 0);
      const force = (target - distance) * RADIAL;
      position.x += (position.x / distance) * force;
      position.y += (position.y / distance) * force;
    }
  }
}

/** The padded rectangle enclosing every position — undefined for an empty
 * layout. The map controller fits the viewport camera to this; the layout
 * itself knows nothing about viewports. */
export function wayfinderLayoutBounds(
  positions: ReadonlyMap<string, WayfinderPosition>,
  pad: number = LAYOUT_BOUNDS_PAD
): WayfinderLayoutBounds | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const position of positions.values()) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x);
    maxY = Math.max(maxY, position.y);
  }
  if (minX === Infinity) return undefined;
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}
