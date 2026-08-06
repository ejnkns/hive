/** @public — the onboarding workflow module. */
import { defineWorkflow } from "workflow-engine/workflow-types";

export { onboardingOperations } from "./onboarding-workflow/operations";

// === ONBOARDING WORKFLOW ===
//
// Turns a plain queen-bee flow into a Project: patches the flow config with the
// queen-bee git identity (integration branch, branch prefix, domain dir),
// validates the bound repository, ensures the Integration Branch, writes
// project metadata (persisted as project.json and committed), and patches the
// flow config with the repo binding (basePath/targetBranch). Project creation
// is a workflow, not an API.

export type OnboardingTaskOutputs = {
  configureFlow: Record<string, unknown>;
  validateRepo: { ok: boolean; basePath?: string };
  ensureIntegrationBranch: { ok: boolean; targetBranch?: string };
  writeProjectMetadata: {
    name: string;
    basePath: string;
    targetBranch: string;
  };
  commitState: { ok: boolean; revision?: string };
  bindFlow: { ok: boolean; config?: Record<string, unknown> };
};

export type OnboardingStateId =
  | "configuring"
  | "validating"
  | "ensuring"
  | "writing"
  | "binding"
  | "complete"
  | "failed";

export const onboardingWorkflow = defineWorkflow({
  id: "onboarding",
  label: "Onboarding",
  description:
    "Bind a repository to a flow: configure the git identity, validate, ensure the integration branch, write project metadata, patch flow config.",
  instance: { title: "Onboarding" },
  ui: { view: "list" },
  taskOutputs: {
    configureFlow: {} as Record<string, unknown>,
    validateRepo: {} as { ok: boolean; basePath?: string },
    ensureIntegrationBranch: {} as { ok: boolean; targetBranch?: string },
    writeProjectMetadata: {} as {
      name: string;
      basePath: string;
      targetBranch: string;
    },
    commitState: {} as { ok: boolean; revision?: string },
    bindFlow: {} as { ok: boolean; config?: Record<string, unknown> },
  },
  states: [
    {
      id: "configuring",
      label: "Configuring",
      category: "initial",
      tasks: [
        {
          id: "configureFlow",
          label: "Configure git identity",
          trigger: "auto",
          role: "operation",
          operations: ["patch_flow_config"],
          operationInputs: {
            integrationBranch: "queen-bee-main",
            branchPrefix: "queen-bee/",
            domainDir: ".queen-bee",
          },
        },
      ],
      autoTransitions: [
        {
          to: "validating",
          gate: (ctx) => ctx.taskOutputs.configureFlow?.status === "success",
        },
      ],
    },
    {
      id: "validating",
      label: "Validating",
      category: "active",
      tasks: [
        {
          id: "validateRepo",
          label: "Validate repository",
          trigger: "auto",
          role: "operation",
          operations: ["validate_repo"],
        },
      ],
      autoTransitions: [
        {
          to: "ensuring",
          gate: (ctx) => ctx.taskOutputs.validateRepo?.status === "success",
        },
        {
          to: "failed",
          gate: (ctx) => ctx.taskOutputs.validateRepo?.status === "error",
        },
      ],
    },
    {
      id: "ensuring",
      label: "Ensuring Integration Branch",
      category: "active",
      tasks: [
        {
          id: "ensureIntegrationBranch",
          label: "Ensure integration branch",
          trigger: "auto",
          role: "operation",
          operations: ["ensure_integration_branch"],
        },
      ],
      autoTransitions: [
        {
          to: "writing",
          gate: (ctx) =>
            ctx.taskOutputs.ensureIntegrationBranch?.status === "success",
        },
        {
          to: "failed",
          gate: (ctx) =>
            ctx.taskOutputs.ensureIntegrationBranch?.status === "error",
        },
      ],
    },
    {
      id: "writing",
      label: "Writing project metadata",
      category: "active",
      tasks: [
        {
          id: "writeProjectMetadata",
          label: "Write project metadata",
          trigger: "auto",
          role: "operation",
          operations: ["write_project_metadata"],
          persist: { path: "project.json" },
        },
        {
          id: "commitState",
          label: "Commit project metadata",
          trigger: "auto",
          role: "operation",
          operations: ["commit_flow_state"],
        },
      ],
      autoTransitions: [
        {
          to: "binding",
          gate: (ctx) =>
            ctx.taskOutputs.writeProjectMetadata?.status === "success" &&
            ctx.taskOutputs.commitState?.status === "success",
        },
        {
          to: "failed",
          gate: (ctx) =>
            ctx.taskOutputs.writeProjectMetadata?.status === "error" ||
            ctx.taskOutputs.commitState?.status === "error",
        },
      ],
    },
    {
      id: "binding",
      label: "Binding flow config",
      category: "active",
      tasks: [
        {
          id: "bindFlow",
          label: "Bind repository to flow config",
          trigger: "auto",
          role: "operation",
          operations: ["patch_flow_config"],
          operationInputs: {
            basePath: "@flow:basePath",
            targetBranch: "@flow:targetBranch",
            name: "@flow:name",
          },
        },
      ],
      autoTransitions: [
        {
          to: "complete",
          gate: (ctx) => ctx.taskOutputs.bindFlow?.status === "success",
        },
        {
          to: "failed",
          gate: (ctx) => ctx.taskOutputs.bindFlow?.status === "error",
        },
      ],
    },
    { id: "complete", label: "Complete", category: "terminal" },
    {
      id: "failed",
      label: "Failed",
      category: "error",
      actions: [
        {
          id: "retry",
          label: "Retry onboarding",
          variant: "secondary",
          transitionTo: "validating",
        },
      ],
    },
  ],
  initial: "configuring",
  terminalStates: ["complete"],
});
