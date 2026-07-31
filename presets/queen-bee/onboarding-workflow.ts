import { defineWorkflow } from "workflow-engine/workflow-types";

// === ONBOARDING WORKFLOW ===
//
// Turns a plain queen-bee flow into a Project: validates the bound repository,
// ensures the Integration Branch, writes `.hive/project.json`, and patches the
// flow config with the repo binding (repoPath/targetBranch) via the
// `patch_flow_config` task operation. This is the replacement for the old
// imperative createFlowForRepo — project creation is a workflow, not an API.

export type OnboardingTaskOutputs = {
  validateRepo: { ok: boolean; repoPath?: string };
  ensureIntegrationBranch: { ok: boolean; targetBranch?: string };
  writeProjectMetadata: { ok: boolean; path?: string };
  bindFlow: { ok: boolean; config?: Record<string, unknown> };
};

export type OnboardingStateId =
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
    "Bind a repository to a flow: validate, ensure integration branch, write project metadata, patch flow config.",
  taskOutputs: {
    validateRepo: {} as { ok: boolean; repoPath?: string },
    ensureIntegrationBranch: {} as { ok: boolean; targetBranch?: string },
    writeProjectMetadata: {} as { ok: boolean; path?: string },
    bindFlow: {} as { ok: boolean; config?: Record<string, unknown> },
  },
  states: [
    {
      id: "validating",
      label: "Validating",
      category: "initial",
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
          gate: (ctx) => ctx.taskOutputs.validateRepo?.output?.ok === true,
        },
        {
          to: "failed",
          gate: (ctx) => ctx.taskOutputs.validateRepo?.output?.ok === false,
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
            ctx.taskOutputs.ensureIntegrationBranch?.output?.ok === true,
        },
        {
          to: "failed",
          gate: (ctx) =>
            ctx.taskOutputs.ensureIntegrationBranch?.output?.ok === false,
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
        },
      ],
      autoTransitions: [
        {
          to: "binding",
          gate: (ctx) =>
            ctx.taskOutputs.writeProjectMetadata?.output?.ok === true,
        },
        {
          to: "failed",
          gate: (ctx) =>
            ctx.taskOutputs.writeProjectMetadata?.output?.ok === false,
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
            repoPath: "@flow:repoPath",
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
  initial: "validating",
  terminalStates: ["complete"],
});
