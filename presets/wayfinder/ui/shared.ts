/** Wayfinder's shared served-component vocabulary. The design language is
 * "expedition, not dashboard": the clear-sky-blue flow accent (--flow-accent,
 * #4a9fe0) against the warm base surfaces, the mountain emblem, a
 * fog → frontier → clear progression, and per-ticket-type badges.
 *
 * Ref-form served modules may value-import sibling module-set files (the
 * server serves the tree to the browser); this module stays TYPE-ONLY by
 * choice — the shared primitives are small so each served module inlines its
 * own css/html fragments, and the type-only imports are erasable. */

import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";

// The ticket resolution types wayfinder's badges render.
export type TicketType = "research" | "prototype" | "grilling" | "task";

// A completed resolution task output read off the instance's taskOutputs.
export type ResolutionOutput = {
  decision?: string;
  gist?: string;
  findings?: string;
  sources?: string[];
  artifactPath?: string;
};

export type TicketEntry = WorkflowInstanceEntry;
