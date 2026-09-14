/** The snapshot-shape variants the visual matrix covers (ticket 18): the
 * mixed lifecycle baseline, empty charting, fog-heavy, dependency-heavy,
 * active, resolved, out-of-scope, and a mixed build/build-item expedition.
 * Every id is a fixed string literal so the layout seed — and therefore the
 * constellation — is stable across builds and Chromatic baselines. */

import {
  wayfinderCharting,
  wayfinderFixtureEntries,
} from "ui/flow-rendering/components/wayfinder-fixtures";
import { entry } from "ui/flow-rendering/test-fixtures";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import { claimAction, ticketEntry } from "./wayfinder-props.ts";

export type SnapshotShape =
  | "mixed"
  | "empty"
  | "fog-heavy"
  | "dependency-heavy"
  | "active"
  | "resolved"
  | "out-of-scope"
  | "build-mix";

/** The mixed lifecycle baseline: the shared wayfinder fixture (charting, fog,
 * blocked, frontier, resolving, closed, out-of-scope, build, build item). */
export function mixedShape(): WorkflowInstanceEntry[] {
  return wayfinderFixtureEntries();
}

/** An expedition with no content nodes: the Base Camp empty state. */
export function emptyShape(): WorkflowInstanceEntry[] {
  const charting = entry("charting-empty", "no_session");
  charting.workflowId = "charting";
  return [charting];
}

/** Fog-heavy: a charted expedition with a large unclarified fog pile. */
export function fogHeavyShape(): WorkflowInstanceEntry[] {
  const briefs = [
    "Do metrics survive the proxy restart?",
    "Who owns the failover window?",
    "Is the retry budget per-request or per-session?",
    "Does the mock provider cover streaming?",
    "What breaks first under connection churn?",
    "Which caches need invalidation on rollback?",
  ];
  return [
    wayfinderCharting(),
    ...briefs.map((brief, index) =>
      ticketEntry(`ticket-fog-${index + 1}`, "fog", { brief })
    ),
  ];
}

/** Dependency-heavy: a ready ticket behind a chain of unsatisfied blockers,
 * plus one frontier ticket whose blockers are all closed. */
export function dependencyHeavyShape(): WorkflowInstanceEntry[] {
  return [
    wayfinderCharting(),
    ticketEntry("ticket-chain-1", "fog", { title: "Probe the seam" }),
    ticketEntry(
      "ticket-chain-2",
      "ready",
      { title: "Design the seam", dependsOn: ["ticket-chain-1"] },
      { blockers: ["ticket-chain-1"], unsatisfied: ["ticket-chain-1"] }
    ),
    ticketEntry(
      "ticket-chain-3",
      "ready",
      { title: "Implement the seam", dependsOn: ["ticket-chain-2"] },
      { blockers: ["ticket-chain-2"], unsatisfied: ["ticket-chain-2"] }
    ),
    ticketEntry("ticket-closed-base", "closed", {
      title: "Read the proxy logs",
    }),
    ticketEntry(
      "ticket-frontier-tip",
      "ready",
      { title: "Wire the seam", dependsOn: ["ticket-closed-base"] },
      { blockers: ["ticket-closed-base"], unsatisfied: [] },
      [claimAction]
    ),
  ];
}

/** Active: everything claimed and resolving (research, prototype, task). */
export function activeShape(): WorkflowInstanceEntry[] {
  return [
    wayfinderCharting(),
    ticketEntry("ticket-active-research", "resolving_research", {
      title: "Grill the provider seam",
      question: "Which provider errors are retryable?",
    }),
    ticketEntry("ticket-active-prototype", "resolving_prototype", {
      title: "Sketch the retry console",
      question: "Where does the retry console live?",
    }),
    ticketEntry("ticket-active-task", "resolving_task", {
      title: "Patch the backoff",
    }),
    ticketEntry("ticket-recording", "recording", {
      title: "Record the failover decision",
    }),
  ];
}

/** Resolved: a decided expedition — closed decisions and accepted builds. */
export function resolvedShape(): WorkflowInstanceEntry[] {
  return [
    wayfinderCharting(),
    ticketEntry("ticket-decided-1", "closed", {
      title: "Concurrency-first pilots",
    }),
    ticketEntry("ticket-decided-2", "closed", {
      title: "Cooldown over half-open",
    }),
    ticketEntry("build-accepted", "accepted", { spec: "# Spec" }),
  ];
}

/** Out-of-scope: ruled-out boundaries stay visible and distinct from closed. */
export function outOfScopeShape(): WorkflowInstanceEntry[] {
  return [
    wayfinderCharting(),
    ticketEntry("ticket-ruled-out-1", "out_of_scope", {
      title: "Rewrite the router",
    }),
    ticketEntry("ticket-ruled-out-2", "out_of_scope", {
      title: "Multi-region failover",
    }),
    ticketEntry("ticket-frontier-remaining", "ready", {
      title: "Pick the failover policy",
    }),
  ];
}

/** Mixed build/build-item: a planned build fanning out into build items at
 * different stages. */
export function buildMixShape(): WorkflowInstanceEntry[] {
  return [
    wayfinderCharting(),
    wayfinderFixtureEntries().find(
      (candidate: WorkflowInstanceEntry) => candidate.id === "build-1"
    ),
    wayfinderFixtureEntries().find(
      (candidate: WorkflowInstanceEntry) => candidate.id === "build-item-1"
    ),
    buildItemEntry("build-item-2", "ready", "Metrics store"),
  ].filter((candidate) => candidate !== undefined);
}

// A build-item entry at an arbitrary state (fixed ids; the shape of the
// build-item fixture in ui's wayfinder-fixtures).
function buildItemEntry(
  id: string,
  currentState: string,
  title: string
): WorkflowInstanceEntry {
  const item = entry(id, currentState);
  item.workflowId = "buildItem";
  item.state.workflowInstanceState = {
    ticket: {
      title,
      description: `Standalone leg: ${title.toLowerCase()}.`,
      acceptanceCriteria: ["Bounded retries"],
    },
    dependsOn: [],
  };
  return item;
}

export function snapshotShape(shape: SnapshotShape): WorkflowInstanceEntry[] {
  switch (shape) {
    case "mixed":
      return mixedShape();
    case "empty":
      return emptyShape();
    case "fog-heavy":
      return fogHeavyShape();
    case "dependency-heavy":
      return dependencyHeavyShape();
    case "active":
      return activeShape();
    case "resolved":
      return resolvedShape();
    case "out-of-scope":
      return outOfScopeShape();
    case "build-mix":
      return buildMixShape();
  }
}
