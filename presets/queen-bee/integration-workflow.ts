/** @public — the integration workflow module. */
import { defineWorkflow } from "workflow-engine/workflow-types";

// === INTEGRATION WORKFLOW ===
//
// Per-project workflow exposing integration as a workflow action: the user
// clicks "Integrate" and a task fast-forwards the Target Branch to the
// Integration Branch via the `fast_forward_target_branch` operation.

export type IntegrationTaskOutputs = {
  commitState: { ok: boolean; skipped?: boolean; revision?: string };
  integrate: Record<string, unknown>;
};

// The integration workflow carries no workflow-instance domain data — it only
// drives flow config and git. Declared empty so every workflow declares its
// state contract (the schema-consistency check requires an anchor).
export type IntegrationItemState = Record<string, never>;

export type IntegrationStateId = "ready" | "integrating" | "integrated";

export const integrationWorkflow = defineWorkflow({
  id: "integration",
  label: "Integration",
  description:
    "Fast-forward the target branch to the integration branch on demand.",
  instance: { title: "Integration" },
  ui: { view: "list" },
  taskOutputs: {
    commitState: {} as { ok: boolean; skipped?: boolean; revision?: string },
    integrate: {} as Record<string, unknown>,
  },
  workflowInstanceState: {} as IntegrationItemState,
  states: [
    {
      id: "ready",
      label: "Ready",
      category: "initial",
      actions: [
        {
          id: "integrate",
          label: "Integrate",
          variant: "primary",
          gate: (ctx) => !ctx.hasRunningTask,
          transitionTo: "integrating",
        },
      ],
    },
    {
      id: "integrating",
      label: "Integrating",
      category: "active",
      tasks: [
        {
          id: "commitState",
          label: "Commit flow state",
          trigger: "auto",
          role: "operation",
          // Record the flow's domain state on the integration branch first so
          // the fast-forward can bring it into the target branch cleanly.
          operations: ["commit_flow_state"],
        },
        {
          id: "integrate",
          label: "Fast-forward target branch",
          trigger: "auto",
          role: "operation",
          operations: ["fast_forward_target_branch"],
        },
      ],
      autoTransitions: [
        {
          to: "integrated",
          gate: (ctx) =>
            ctx.taskOutputs.commitState?.status === "success" &&
            ctx.taskOutputs.integrate?.status === "success",
        },
        {
          to: "ready",
          gate: (ctx) => ctx.taskOutputs.integrate?.status === "error",
        },
      ],
    },
    { id: "integrated", label: "Integrated", category: "terminal" },
  ],
  initial: "ready",
  terminalStates: ["integrated"],
});
