/** Wayfinder's shared served-component vocabulary. The design language is
 * "expedition, not dashboard": the clear-sky-blue flow accent (--flow-accent,
 * #4a9fe0) against the warm base surfaces, the mountain emblem, a
 * fog → frontier → clear progression, and per-ticket-type badges.
 *
 * Served component modules are import-free at runtime (evaluated standalone,
 * the lit runtime injected through the factory), so this module carries only
 * TYPES — the modules import it type-only (erasable, stripped before serving)
 * and inline their own css/html fragments. The badges/chips/inline-chat
 * primitives are deliberately small so the per-module copies stay honest. */

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
