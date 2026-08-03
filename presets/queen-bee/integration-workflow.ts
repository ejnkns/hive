/** @public — the integration workflow module. */
import { defineWorkflow } from "workflow-engine/workflow-types";

export { integrationOperations } from "./integration-workflow/operations";

// === INTEGRATION WORKFLOW ===
//
// Per-project workflow exposing integration as a workflow action: the user
// clicks "Integrate" and a task fast-forwards the Target Branch to the
// Integration Branch via the `fast_forward_target_branch` operation.

export type IntegrationTaskOutputs = {
  integrate: Record<string, unknown>;
};

export type IntegrationStateId = "ready" | "integrating" | "integrated";

export const integrationWorkflow = defineWorkflow({
  id: "integration",
  label: "Integration",
  description:
    "Fast-forward the target branch to the integration branch on demand.",
  item: { title: "Integration" },
  taskOutputs: {
    integrate: {} as Record<string, unknown>,
  },
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
          gate: (ctx) => ctx.taskOutputs.integrate?.status === "success",
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
