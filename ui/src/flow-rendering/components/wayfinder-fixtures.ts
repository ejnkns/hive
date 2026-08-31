/** @public — the shared wayfinder baseline fixture (test support).
 *
 * One representative FlowInstance snapshot every wayfinder map/UI test
 * builds on: the charting session plus one WorkflowItem per lifecycle
 * position — a fog ticket, an actually frontier-ready ticket, a
 * ready-but-blocked ticket, an active (resolving) ticket, a closed decision,
 * an out-of-scope boundary, and a build/build-item pair.
 *
 * Baseline compatibility requirements this snapshot pins (do not regress
 * while refactoring the map UI):
 * - Map-first: a populated expedition defaults to the map shell with the HUD
 *   (map-shell.ts); the Map/Table toggle switches to the cartographer's table
 *   (table-shell.ts composing the wayfinder-table.ts workbench); a newly
 *   created flow (no content nodes) presents the Base Camp empty state
 *   (base-camp.ts). View mode persists in
 *   sessionStorage under `hive:view:<flowId>:view` ("map"/"table"), with the
 *   legacy pre-view-mode `hive:view:<flowId>:map-open` ("1"/"0") read as a
 *   fallback; `hive:view:<flowId>:fog-order` (JSON id list) stays. All
 *   session-scoped per FlowInstance and restored in `willUpdate`
 *   (wayfinder-presets.component.test.ts "defaults to the map-first view…",
 *   "persists the view mode…", "restores the legacy map-open storage key…",
 *   "view state is flow-scoped…"). No other view state is persisted.
 * - The HUD counts come from the shared presentation model's derived counts
 *   (`WayfinderMap.counts`): the frontier chip is the blockers-closed
 *   frontier, never a recount of `ready` WorkflowItems; progress is
 *   decisions / (fog + frontier + blocked + active + decision), excluding
 *   out-of-scope boundaries and implementation items.
 * - Themes are `mountain | topo | stars` (wayfinder-themes.ts), selected via
 *   the flow CONFIG field `expeditionTheme` — static per FlowInstance, not
 *   persisted UI state; `mountain` is the default. The theme wrapper in the
 *   entry defines the --wf-* and --map-backdrop variables; the shells inherit
 *   them and reflect data-theme on their hosts.
 * - Live chat renders inside a card while its WorkflowItem runs an
 *   interactive ai-chat session (`runningTaskContext.role === "ai-chat"` with
 *   `interactive: true`), surfacing `<chat-session>` and `onSendMessage`.
 * - Actions render per WorkflowItem on the table cards from
 *   `availableActions` (data-driven labels/variants) and flow-level actions
 *   in the HUD and table header; the map view renders no per-item actions.
 *   The claim action is gated on dependsOn blockers being closed
 *   (presets/wayfinder/gates/blockers-closed.ts + the engine's
 *   dependsOnState backstop).
 * - Journal drill-in: closed tickets list in the journal and toggle open
 *   their persisted decision record from the `decisions/` persisted output
 *   dir, keyed `<ticketId>.md`; a missing record degrades to "No decision
 *   record persisted."
 * - Fog ordering: fog cards drag into a session-local clear order
 *   (persisted per flow); the map derivation itself places fog nodes by
 *   entry order in a deterministic grid. No dependsOn-based ordering exists
 *   anywhere in the UI today.
 * - There is no detail drawer today: selecting a node/card only highlights
 *   and pulses. Presentation status is derived UI state, never a second
 *   domain status field. `ready` + every dependsOn blocker closed =
 *   frontier; `ready` with unresolved blockers renders blocked — closed by
 *   the map-presentation-model ticket, which derives both from the
 *   `dependsOn` field already on the WorkflowItem state (no domain field
 *   was missing).
 *
 * Browser-free: plain data builders over ../test-fixtures.ts, importable by
 * both the `node --test` pure suite and the vitest jsdom component suite.
 */

import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import { entry } from "../test-fixtures.ts";

// The charting session: owns the destination the summit node renders.
export function wayfinderCharting(): WorkflowInstanceEntry {
  const charting = entry("charting-1", "charted");
  charting.workflowId = "charting";
  charting.state.workflowInstanceState = {
    destination: "Hive router resilience",
    notes: "offline-first, provider failover",
  };
  return charting;
}

// A fog ticket: unresolved brief, not yet graduated (fog entries omit
// `graduated` — the flow's auto-transition reads it).
export function wayfinderFogTicket(): WorkflowInstanceEntry {
  const ticket = entry("ticket-fog", "fog");
  ticket.workflowId = "ticket";
  ticket.state.workflowInstanceState = {
    brief: "Do metrics survive the proxy restart?",
  };
  return ticket;
}

// An actually frontier-ready ticket: every dependsOn blocker is closed, so
// its presentation status is frontier.
export function wayfinderFrontierTicket(): WorkflowInstanceEntry {
  const ticket = entry("ticket-frontier", "ready");
  ticket.workflowId = "ticket";
  ticket.state.workflowInstanceState = {
    title: "Pick the failover policy",
    question: "Circuit-breaker half-open or cooldown-first?",
    type: "research",
    dependsOn: ["ticket-decision"],
  };
  return ticket;
}

// A ready-but-blocked ticket: `ready` in domain state, but dependsOn names a
// blocker that is not closed — it must present as blocked, not frontier.
export function wayfinderBlockedTicket(): WorkflowInstanceEntry {
  const ticket = entry("ticket-blocked", "ready");
  ticket.workflowId = "ticket";
  ticket.state.workflowInstanceState = {
    title: "Sketch the retry console",
    question: "Where does the retry console live?",
    type: "prototype",
    dependsOn: ["ticket-fog"],
  };
  return ticket;
}

// An active ticket: claimed and resolving (research, AFK one-shot shape).
export function wayfinderResolvingTicket(): WorkflowInstanceEntry {
  const ticket = entry("ticket-resolving", "resolving_research");
  ticket.workflowId = "ticket";
  ticket.state.workflowInstanceState = {
    title: "Grill the provider seam",
    question: "Which provider errors are retryable?",
    type: "research",
  };
  return ticket;
}

// A closed decision: terminal, journal-drillable via its persisted record.
export function wayfinderClosedTicket(): WorkflowInstanceEntry {
  const ticket = entry("ticket-decision", "closed");
  ticket.workflowId = "ticket";
  ticket.state.workflowInstanceState = {
    title: "Concurrency-first pilots",
    question: "Serialize pilots or run them concurrently?",
    type: "research",
  };
  return ticket;
}

// An out-of-scope boundary: distinct from closed, never satisfies a
// dependency.
export function wayfinderOutOfScopeTicket(): WorkflowInstanceEntry {
  const ticket = entry("ticket-out-of-scope", "out_of_scope");
  ticket.workflowId = "ticket";
  ticket.state.workflowInstanceState = {
    title: "Carve-out audit",
    question: "Audit the metrics carve-out?",
    type: "task",
  };
  return ticket;
}

// A build WorkflowItem: the implementation phase container (specing →
// planned → accepted).
export function wayfinderBuild(): WorkflowInstanceEntry {
  const build = entry("build-1", "planned");
  build.workflowId = "build";
  build.state.workflowInstanceState = {
    spec: "# Spec\n\nFailover first, then the retry console.",
  };
  return build;
}

// A build item: one fanned-out build ticket, mid-flight.
export function wayfinderBuildItem(): WorkflowInstanceEntry {
  const buildItem = entry("build-item-1", "working");
  buildItem.workflowId = "buildItem";
  buildItem.state.workflowInstanceState = {
    ticket: {
      title: "Retry loop",
      description: "Retry the router with backoff.",
      acceptanceCriteria: ["Retries are bounded"],
    },
    dependsOn: [],
  };
  return buildItem;
}

/** The full representative snapshot: every lifecycle position at once, in a
 * stable order (charting, fog, blocked, frontier, resolving, closed,
 * out-of-scope, build, build item). */
export function wayfinderFixtureEntries(): WorkflowInstanceEntry[] {
  return [
    wayfinderCharting(),
    wayfinderFogTicket(),
    wayfinderBlockedTicket(),
    wayfinderFrontierTicket(),
    wayfinderResolvingTicket(),
    wayfinderClosedTicket(),
    wayfinderOutOfScopeTicket(),
    wayfinderBuild(),
    wayfinderBuildItem(),
  ];
}

/** The persisted decision record the closed ticket's journal drill-in reads
 * (shape of the `persistedOutputDirs.decisions` prop the flow snapshot
 * ships). Keyed by `<ticketId>.md` — the flow persists one record per closed
 * ticket. */
export const WAYFINDER_DECISION_RECORDS: Record<
  string,
  Record<string, string>
> = {
  decisions: {
    "ticket-decision.md":
      "# Decision — Concurrency-first pilots\n\n## Decision\n" +
      "Pilots run concurrently; the frontier serializes only the merge.\n",
  },
};
