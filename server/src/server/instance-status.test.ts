import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { RunningTaskContext } from "workflow-engine/workflow-types";
import { computeInstanceStatus, type InstanceStatus } from "./instance-status";

const workflow: WorkflowDefResponse = {
  id: "wf",
  label: "Workflow",
  states: [
    { id: "idle", label: "Idle", category: "initial", actions: [] },
    { id: "active", label: "Active", category: "active", actions: [] },
    { id: "failed", label: "Failed", category: "error", actions: [] },
    { id: "done", label: "Done", category: "terminal", actions: [] },
  ],
  initial: "idle",
  terminalStates: ["done"],
};

function entry(
  currentState: string,
  options: { role?: RunningTaskContext["role"] } = {}
): WorkflowInstanceEntry {
  const { role } = options;
  return {
    id: "inst-1",
    workflowId: "wf",
    state: {
      currentState,
      taskOutputs: {},
      hasRunningTask: role !== undefined,
      runningTaskId: role !== undefined ? "task-1" : null,
      runningTaskContext:
        role === "ai-chat"
          ? {
              role: "ai-chat",
              messages: [],
              sessionId: "s1",
              interactive: true,
            }
          : role === "ai-task"
            ? { role: "ai-task", messages: [] }
            : role === "operation"
              ? { role: "operation" }
              : null,
      workflowInstanceState: {},
      history: [],
    },
    availableActions: [],
    editFields: [],
    workflowSummary: { total: 0, byField: {} },
  };
}

function status(instances: WorkflowInstanceEntry[]): InstanceStatus {
  return computeInstanceStatus([workflow], instances);
}

describe("computeInstanceStatus", () => {
  it("reports idle for a flow with no instances", () => {
    assert.equal(status([]), "idle");
  });

  it("reports complete when every instance is terminal", () => {
    assert.equal(status([entry("done"), entry("done")]), "complete");
  });

  it("reports idle when an instance is not terminal and no task is running", () => {
    assert.equal(status([entry("active")]), "idle");
  });

  it("reports running for an active non-ai-chat task", () => {
    assert.equal(status([entry("active", { role: "operation" })]), "running");
    assert.equal(status([entry("active", { role: "ai-task" })]), "running");
  });

  it("reports waiting for an active ai-chat session", () => {
    assert.equal(status([entry("active", { role: "ai-chat" })]), "waiting");
  });

  it("reports error for an instance in an error-category state", () => {
    assert.equal(status([entry("failed")]), "error");
  });

  it("gives error precedence over running and waiting", () => {
    assert.equal(
      status([entry("failed"), entry("active", { role: "operation" })]),
      "error"
    );
    assert.equal(
      status([entry("failed"), entry("active", { role: "ai-chat" })]),
      "error"
    );
  });

  it("gives running precedence over waiting", () => {
    assert.equal(
      status([
        entry("active", { role: "operation" }),
        entry("active", { role: "ai-chat" }),
      ]),
      "running"
    );
  });

  it("gives waiting precedence over a terminal-only rest", () => {
    assert.equal(
      status([entry("active", { role: "ai-chat" }), entry("done")]),
      "waiting"
    );
  });
});
