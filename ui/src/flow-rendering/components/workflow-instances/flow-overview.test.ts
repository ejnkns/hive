import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OverviewDef, OverviewEntry } from "./flow-overview.ts";
import { computeFlowOverview } from "./flow-overview.ts";

const defs: OverviewDef[] = [
  {
    id: "ideas",
    label: "Ideas",
    states: [
      { id: "backlog", category: "initial" },
      { id: "archived", category: "terminal" },
    ],
    terminalStates: ["archived"],
  },
  {
    id: "cards",
    label: "Cards",
    states: [
      { id: "ready", category: "initial" },
      { id: "running_agent", category: "active" },
      { id: "unfulfillable", category: "error" },
      { id: "done", category: "terminal" },
    ],
    terminalStates: ["done"],
  },
];

function entry(
  workflowId: string,
  currentState: string,
  options: {
    running?: boolean;
    chat?: boolean;
    actions?: number;
  } = {}
): OverviewEntry {
  return {
    workflowId,
    state: {
      currentState,
      hasRunningTask: options.running ?? false,
      runningTaskContext:
        options.running === true
          ? { role: options.chat === true ? "ai-chat" : "ai-task" }
          : null,
    },
    availableActions: Array.from({ length: options.actions ?? 0 }),
  };
}

describe("computeFlowOverview", () => {
  it("aggregates totals across workflows", () => {
    const overview = computeFlowOverview(defs, [
      entry("ideas", "backlog"),
      entry("cards", "ready", { actions: 2 }),
      entry("cards", "done"),
      entry("cards", "unfulfillable"),
    ]);
    assert.deepEqual(overview.totals, {
      instances: 4,
      running: 0,
      waiting: 0,
      error: 1,
      terminal: 1,
      decisions: 1,
    });
    assert.equal(overview.byWorkflow.length, 2);
  });

  it("counts running and waiting work by task role", () => {
    const overview = computeFlowOverview(defs, [
      entry("cards", "running_agent", { running: true, chat: false }),
      entry("cards", "running_agent", { running: true, chat: true }),
    ]);
    assert.deepEqual(overview.byWorkflow[1].running, 1);
    assert.deepEqual(overview.byWorkflow[1].waiting, 1);
  });

  it("derives per-workflow status with server precedence (error > running > waiting > complete > idle)", () => {
    const run = (states: string[]): string => {
      const overview = computeFlowOverview(
        defs,
        states.map((s) => entry("cards", s))
      );
      return overview.byWorkflow[1].status;
    };
    assert.equal(run(["unfulfillable"]), "error");
    assert.equal(run(["unfulfillable", "done"]), "error");
    assert.equal(run(["ready", "done"]), "idle");
    assert.equal(run(["done", "done"]), "complete");
    assert.equal(run([]), "idle");
    // A running task in an error state reports error (precedence).
    assert.equal(
      computeFlowOverview(defs, [
        entry("cards", "unfulfillable", { running: true }),
      ]).byWorkflow[1].status,
      "error"
    );
  });

  it("reports idle for a workflow with zero instances", () => {
    const overview = computeFlowOverview(defs, []);
    assert.equal(overview.byWorkflow[0].status, "idle");
    assert.equal(overview.byWorkflow[0].total, 0);
    assert.equal(overview.totals.instances, 0);
  });

  it("counts decisions only where actions are available", () => {
    const overview = computeFlowOverview(defs, [
      entry("cards", "ready", { actions: 3 }),
      entry("cards", "done", { actions: 0 }),
      entry("ideas", "backlog"),
    ]);
    assert.equal(overview.byWorkflow[1].decisions, 1);
  });
});
