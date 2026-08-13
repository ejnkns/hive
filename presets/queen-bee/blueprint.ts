/** @public — the queen-bee preset as a FlowBlueprint: the design artifact the
 * renderer turns into the definition module set (entry + referenced files).
 * The workflows/states/tasks/actions/edges are structured data; custom tools,
 * operations, gates, and system prompts are file references; the served
 * idea-card component is inline via ui.components (imported from ideas-card.ts
 * so the source string lives beside the blueprint).
 *
 * The object is intentionally unannotated: the FlowBlueprint type lives in the
 * server package (presets cannot import it without a layering cycle), so the
 * structural check happens at registration, where renderFlowDefinition's
 * FlowBlueprint parameter and validateFlowBlueprint gate the shape. */

import { ideaCardComponentSource } from "./ideas-card.ts";

export const queenBeeBlueprint = {
  id: "queen-bee",
  label: "Queen Bee",
  description:
    "Project lifecycle: onboarding, requirements, ideas, cards, integration.",
  configSchema: [
    {
      key: "basePath",
      label: "Base path",
      type: "string",
      required: true,
      hint: "A git repository root or a plain directory to bind the flow to.",
    },
  ],
  domainDir: ".queen-bee",
  ui: {
    components: {
      "idea-card": ideaCardComponentSource,
    },
  },
  tools: [
    {
      id: "update_requirements_draft",
      ref: "./tools/update-requirements-draft.ts",
      writes: ["requirementsDraft"],
    },
  ],
  operations: [
    {
      id: "ensure_integration_branch",
      ref: "./onboarding/ops/ensure-integration-branch.ts",
    },
    {
      id: "write_project_metadata",
      ref: "./onboarding/ops/write-project-metadata.ts",
    },
    {
      id: "finalize_requirements",
      ref: "./requirements/ops/finalize-requirements.ts",
    },
    {
      id: "clear_requirements_state",
      ref: "./requirements/ops/clear-requirements-state.ts",
      writes: ["requirementsDraft"],
    },
    {
      id: "build_review_package",
      ref: "./cards/ops/build-review-package.ts",
    },
    {
      id: "check_review_freshness",
      ref: "./cards/ops/check-review-freshness.ts",
      writes: ["reviewIsStale"],
    },
    {
      id: "fast_forward_target_branch",
      ref: "./integration/ops/fast-forward-target-branch.ts",
    },
  ],
  workflows: [
    // ── onboarding: bind a repository, making the flow a Project ──
    {
      id: "onboarding",
      label: "Onboarding",
      description:
        "Bind a repository to a flow: configure the git identity, validate, ensure the integration branch, write project metadata, patch flow config.",
      ui: { view: "list" },
      instanceState: [],
      initialState: "configuring",
      terminalStates: ["complete"],
      states: [
        {
          id: "configuring",
          label: "Configuring",
          category: "initial",
          tasks: [
            {
              id: "configureFlow",
              label: "Configure git identity",
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
              gate: { kind: "taskSuccess", task: "configureFlow" },
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
              role: "operation",
              operations: ["validate_repo"],
            },
          ],
          autoTransitions: [
            {
              to: "ensuring",
              gate: { kind: "taskSuccess", task: "validateRepo" },
            },
            {
              to: "failed",
              gate: { kind: "taskError", task: "validateRepo" },
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
              role: "operation",
              operations: ["ensure_integration_branch"],
            },
          ],
          autoTransitions: [
            {
              to: "writing",
              gate: { kind: "taskSuccess", task: "ensureIntegrationBranch" },
            },
            {
              to: "failed",
              gate: { kind: "taskError", task: "ensureIntegrationBranch" },
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
              role: "operation",
              operations: ["write_project_metadata"],
              persist: { path: "project.json" },
            },
            {
              id: "commitState",
              label: "Commit project metadata",
              role: "operation",
              operations: ["commit_flow_state"],
            },
          ],
          autoTransitions: [
            {
              to: "binding",
              gate: {
                kind: "and",
                gates: [
                  { kind: "taskSuccess", task: "writeProjectMetadata" },
                  { kind: "taskSuccess", task: "commitState" },
                ],
              },
            },
            {
              to: "failed",
              gate: {
                kind: "or",
                gates: [
                  { kind: "taskError", task: "writeProjectMetadata" },
                  { kind: "taskError", task: "commitState" },
                ],
              },
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
              gate: { kind: "taskSuccess", task: "bindFlow" },
            },
            {
              to: "failed",
              gate: { kind: "taskError", task: "bindFlow" },
            },
          ],
        },
        {
          id: "complete",
          label: "Complete",
          category: "terminal",
        },
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
    },
    // ── requirements: session + planner agent ──
    {
      id: "requirements",
      label: "Requirements",
      ui: { view: "document" },
      instanceState: [{ field: "requirementsDraft", type: "string" }],
      initialState: "no_session",
      terminalStates: ["accepted"],
      states: [
        {
          id: "no_session",
          label: "No Session",
          category: "initial",
          actions: [
            {
              id: "start",
              label: "Start requirements session",
              variant: "primary",
              gate: { kind: "noRunningTask" },
              transitionTo: "drafting",
            },
          ],
        },
        {
          id: "drafting",
          label: "Drafting",
          category: "active",
          tasks: [
            {
              id: "draft",
              label: "Requirements session",
              role: "ai-chat",
              startOnUserInput: true,
              tools: [
                "list_directory",
                "read_file",
                "search_code",
                "update_requirements_draft",
              ],
              completionSignal: "REQUIREMENTS_COMPLETE",
              systemPromptRef: "./requirements/prompts/draft.ts",
            },
          ],
          autoTransitions: [
            {
              to: "complete",
              gate: { kind: "taskSuccess", task: "draft" },
            },
          ],
          actions: [
            {
              id: "cancel",
              label: "Cancel session",
              variant: "secondary",
              gate: { kind: "hasRunningTask" },
              transitionTo: "no_session",
            },
            {
              id: "reset",
              label: "Reset",
              variant: "secondary",
              transitionTo: "clearing",
            },
          ],
        },
        {
          id: "complete",
          label: "Complete",
          category: "active",
          actions: [
            {
              id: "approve",
              label: "Submit for planning",
              variant: "primary",
              // A requirements document must be recorded before planning: the
              // planner is grounded in it, and finalizing persists it.
              gate: {
                kind: "and",
                gates: [
                  { kind: "noRunningTask" },
                  {
                    kind: "file",
                    ref: "./requirements/gates/draft-recorded.ts",
                  },
                ],
              },
              transitionTo: "planning",
            },
            {
              id: "reset",
              label: "Reset",
              variant: "secondary",
              transitionTo: "clearing",
            },
          ],
        },
        {
          id: "planning",
          label: "Planning",
          category: "active",
          tasks: [
            {
              id: "plan",
              label: "Run planner",
              role: "ai-task",
              tools: ["read_file", "search_code"],
              completionOutput: [
                {
                  field: "kind",
                  type: "string",
                  description: '"proposal" or "feedback".',
                },
                {
                  field: "guidance",
                  type: "string",
                  description:
                    "Required when kind is feedback: what to revise and why.",
                },
                {
                  field: "cards",
                  type: "object[]",
                  description:
                    "Required when kind is proposal: one entry per card, each shaped { cardSpec: { title, description, acceptanceCriteria }, dependencies }.",
                },
              ],
              inputFromInstanceState: "requirementsDraft",
              systemPromptRef: "./requirements/prompts/planner.ts",
            },
          ],
          actions: [
            {
              id: "accept_proposal",
              label: "Accept proposal",
              variant: "primary",
              gate: {
                kind: "and",
                gates: [
                  { kind: "noRunningTask" },
                  {
                    kind: "taskOutputEquals",
                    task: "plan",
                    path: "output.kind",
                    value: "proposal",
                  },
                ],
              },
              transitionTo: "planned",
            },
            {
              id: "repair",
              label: "Start repair session",
              variant: "secondary",
              gate: {
                kind: "and",
                gates: [
                  { kind: "noRunningTask" },
                  {
                    kind: "taskOutputEquals",
                    task: "plan",
                    path: "output.kind",
                    value: "feedback",
                  },
                ],
              },
              transitionTo: "drafting",
            },
            {
              id: "reset",
              label: "Reset",
              variant: "secondary",
              transitionTo: "clearing",
            },
          ],
        },
        {
          id: "planned",
          label: "Planned",
          category: "active",
          actions: [
            {
              id: "accept_all",
              label: "Accept all and create cards",
              variant: "primary",
              transitionTo: "finalizing",
            },
            {
              id: "replan",
              label: "Request replanning",
              variant: "secondary",
              transitionTo: "complete",
            },
            {
              id: "reset",
              label: "Reset",
              variant: "secondary",
              transitionTo: "clearing",
            },
          ],
        },
        {
          id: "finalizing",
          label: "Finalizing",
          category: "active",
          tasks: [
            {
              id: "finalizeRequirements",
              label: "Write requirements document",
              role: "operation",
              operations: ["finalize_requirements"],
              persist: { path: "requirements.md" },
            },
            {
              id: "commitState",
              label: "Commit requirements document",
              role: "operation",
              operations: ["commit_flow_state"],
            },
          ],
          autoTransitions: [
            {
              to: "accepted",
              gate: {
                kind: "and",
                gates: [
                  { kind: "taskSuccess", task: "finalizeRequirements" },
                  { kind: "taskSuccess", task: "commitState" },
                ],
              },
            },
            {
              to: "complete",
              gate: {
                kind: "or",
                gates: [
                  { kind: "taskError", task: "finalizeRequirements" },
                  { kind: "taskError", task: "commitState" },
                ],
              },
            },
          ],
          actions: [
            {
              id: "reset",
              label: "Reset",
              variant: "secondary",
              transitionTo: "clearing",
            },
          ],
        },
        {
          id: "accepted",
          label: "Accepted",
          category: "terminal",
          actions: [
            {
              id: "reset",
              label: "Reset",
              variant: "secondary",
              transitionTo: "clearing",
            },
          ],
        },
        {
          id: "clearing",
          label: "Clearing",
          category: "active",
          tasks: [
            {
              id: "clearRequirements",
              label: "Clear requirements state",
              role: "operation",
              operations: ["clear_requirements_state"],
            },
          ],
          autoTransitions: [
            {
              to: "no_session",
              gate: { kind: "taskSuccess", task: "clearRequirements" },
            },
          ],
        },
      ],
    },
    // ── ideas: per-idea items, fed into planning ──
    {
      id: "ideas",
      label: "Ideas",
      instance: { title: "title" },
      ui: {
        view: "list",
        // The served idea-card (the flow's ui.components "idea-card") replaces
        // the default instance card for ideas.
        instanceComponent: "idea-card",
      },
      instanceState: [
        { field: "title", type: "string" },
        { field: "brief", type: "string" },
      ],
      initialState: "backlog",
      terminalStates: ["submitted", "archived"],
      states: [
        {
          id: "backlog",
          label: "Backlog",
          category: "initial",
          actions: [
            {
              id: "elaborate",
              label: "Elaborate idea",
              variant: "primary",
              gate: { kind: "noRunningTask" },
              transitionTo: "elaborating",
            },
            {
              id: "archive",
              label: "Archive",
              variant: "secondary",
              transitionTo: "archived",
            },
          ],
        },
        {
          id: "elaborating",
          label: "Elaborating",
          category: "active",
          tasks: [
            {
              id: "elaborate",
              label: "Elaborate session",
              role: "ai-chat",
              startOnUserInput: true,
              tools: ["list_directory", "read_file", "search_code"],
              inputFromInstanceState: "brief",
              completionSignal: "IDEA_COMPLETE",
              systemPromptRef: "./ideas/prompts/elaboration.ts",
            },
          ],
          autoTransitions: [
            {
              to: "refined",
              gate: { kind: "taskSuccess", task: "elaborate" },
            },
          ],
          actions: [
            {
              id: "cancel",
              label: "Cancel",
              variant: "secondary",
              gate: { kind: "hasRunningTask" },
              transitionTo: "backlog",
            },
          ],
        },
        {
          id: "refined",
          label: "Refined",
          category: "active",
          actions: [
            {
              id: "approve",
              label: "Submit for planning",
              variant: "primary",
              transitionTo: "submitted",
            },
            {
              id: "reopen",
              label: "Reopen",
              variant: "secondary",
              transitionTo: "backlog",
            },
          ],
        },
        {
          id: "submitted",
          label: "Submitted",
          category: "active",
        },
        {
          id: "archived",
          label: "Archived",
          category: "terminal",
        },
      ],
    },
    // ── cards: worker agent, completion gate, reviewer, coordinator ──
    {
      id: "cards",
      label: "Cards",
      description:
        "Per-card workflow: worktree, worker agent, completion gate, reviewer, coordinator.",
      instance: { title: "cardSpec.title" },
      ui: {
        view: "board",
        // Canonical board: transient states fold into their parent lane so the
        // cards render Ready / In Progress / Reviewing / Done / Unfulfillable.
        columns: [
          { id: "ready", label: "Ready", states: ["ready"] },
          {
            id: "in_progress",
            label: "In Progress",
            states: ["in_progress", "running_agent", "validating"],
          },
          {
            id: "reviewing",
            label: "Reviewing",
            states: ["reviewing", "running_review", "reviewed", "accepting"],
          },
          { id: "done", label: "Done", states: ["done"] },
          {
            id: "unfulfillable",
            label: "Unfulfillable",
            states: ["unfulfillable"],
          },
        ],
      },
      display: {
        fields: [
          {
            path: "cardSpec",
            label: "Card spec",
            render: {
              kind: "card",
              props: {
                title: "title",
                description: "description",
                bullets: "acceptanceCriteria",
              },
            },
          },
          {
            path: "dependsOn",
            label: "Depends on",
          },
        ],
      },
      instanceState: [
        { field: "attempt", type: "number" },
        { field: "reviewIsStale", type: "boolean" },
        { field: "worktreePath", type: "string" },
        { field: "branchName", type: "string" },
        { field: "cardSpec", type: "object" },
        { field: "dependsOn", type: "string[]" },
      ],
      initialState: "ready",
      terminalStates: ["done"],
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [
            {
              id: "run",
              label: "Run Worker Agent",
              variant: "primary",
              maxWorkflowInstancesInTarget: 3,
              dependsOnState: "done",
              gate: { kind: "noRunningTask" },
              transitionTo: "in_progress",
            },
          ],
        },
        {
          id: "in_progress",
          label: "In Progress",
          category: "active",
          tasks: [
            {
              id: "prepareWorktree",
              label: "Prepare worktree",
              role: "operation",
              operations: ["prepare_worktree"],
            },
          ],
          autoTransitions: [
            {
              to: "running_agent",
              gate: { kind: "taskSuccess", task: "prepareWorktree" },
            },
            {
              to: "unfulfillable",
              gate: { kind: "taskError", task: "prepareWorktree" },
            },
          ],
          actions: [
            {
              id: "cancel",
              label: "Cancel",
              variant: "secondary",
              gate: { kind: "hasRunningTask" },
              transitionTo: "ready",
            },
          ],
        },
        {
          id: "running_agent",
          label: "Running Agent",
          category: "active",
          tasks: [
            {
              id: "runAgent",
              label: "Run worker agent",
              role: "ai-chat",
              workspacePath: "@instance:worktreePath",
              tools: [
                "read_file",
                "write_file",
                "run_command",
                "git_status",
                "git_diff",
                "git_log",
                "commit_work",
              ],
              completionOutput: [
                {
                  field: "outcome",
                  type: "string",
                  description: '"implemented" or "already_satisfied".',
                },
                {
                  field: "verificationCallIds",
                  type: "string[]",
                  description:
                    "Successful run_command tool call IDs that verified the current commit.",
                },
                {
                  field: "verificationNotRunReason",
                  type: "string",
                  description:
                    "Why no applicable automated check exists, when verification was not run.",
                },
                {
                  field: "noChangeRationale",
                  type: "string",
                  description:
                    "Precise rationale when the behavior was already present.",
                },
              ],
              systemPromptRef: "./cards/prompts/worker.ts",
            },
          ],
          autoTransitions: [
            {
              // The worker reports the requested behavior already present (no
              // commit created — nothing to validate); the reviewer verifies the
              // claim against the requirements and the integration branch.
              to: "reviewing",
              gate: {
                kind: "taskOutputEquals",
                task: "runAgent",
                path: "output.completion.outcome",
                value: "already_satisfied",
              },
            },
            {
              to: "validating",
              gate: { kind: "taskSuccess", task: "runAgent" },
            },
            {
              to: "unfulfillable",
              gate: { kind: "taskError", task: "runAgent" },
            },
          ],
        },
        {
          id: "validating",
          label: "Validating",
          category: "active",
          tasks: [
            {
              id: "validateCompletion",
              label: "Validate completion",
              role: "operation",
              // Engine-owned verification: the feature branch must be ahead of
              // the integration branch (committed work). Declared, not coded.
              operations: ["verify_workspace"],
              operationInputs: { require: "committed" },
            },
          ],
          autoTransitions: [
            {
              to: "reviewing",
              gate: { kind: "taskSuccess", task: "validateCompletion" },
            },
            {
              // The engine tracks consecutive per-task errors; three failed
              // validations escalate to unfulfillable (coordinator analysis +
              // human remediation) instead of retrying the worker forever.
              to: "unfulfillable",
              gate: {
                kind: "errorCountAtLeast",
                task: "validateCompletion",
                count: 3,
              },
            },
            {
              to: "running_agent",
              gate: {
                kind: "and",
                gates: [
                  { kind: "taskError", task: "validateCompletion" },
                  {
                    kind: "not",
                    gate: {
                      kind: "errorCountAtLeast",
                      task: "validateCompletion",
                      count: 3,
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: "reviewing",
          label: "Reviewing",
          category: "active",
          tasks: [
            {
              id: "buildPackage",
              label: "Build review package",
              role: "operation",
              operations: ["build_review_package"],
              persist: { path: "reviews/{instanceId}-{attempt}.json" },
            },
          ],
          autoTransitions: [
            {
              to: "running_review",
              gate: { kind: "taskSuccess", task: "buildPackage" },
            },
          ],
        },
        {
          id: "running_review",
          label: "Running Review",
          category: "active",
          tasks: [
            {
              id: "review",
              label: "Run reviewer agent",
              role: "ai-task",
              workspacePath: "@instance:worktreePath",
              tools: [
                "read_file",
                "list_directory",
                "search_code",
                "git_diff",
                "git_log",
                "git_show",
              ],
              completionOutput: [
                {
                  field: "verdict",
                  type: "string",
                  description: '"approved" or "changes_requested".',
                },
                {
                  field: "recommendedApproach",
                  type: "string",
                  description: '"update" or "new".',
                },
                {
                  field: "findings",
                  type: "object[]",
                  description:
                    "Each finding: severity, requirement, evidence, recommendation.",
                },
                {
                  field: "verificationAssessment",
                  type: "object",
                  description:
                    '{ status: "sufficient" | "insufficient", notes }.',
                },
              ],
              systemPromptRef: "./cards/prompts/reviewer.ts",
            },
          ],
          autoTransitions: [
            {
              to: "reviewed",
              gate: { kind: "taskSuccess", task: "review" },
            },
          ],
        },
        {
          id: "reviewed",
          label: "Reviewed",
          category: "active",
          tasks: [
            {
              id: "checkFreshness",
              label: "Check review freshness",
              role: "operation",
              operations: ["check_review_freshness"],
            },
          ],
          actions: [
            {
              id: "accept",
              label: "Accept work",
              variant: "primary",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "taskOutputEquals",
                    task: "review",
                    path: "output.verdict",
                    value: "approved",
                  },
                  {
                    kind: "not",
                    gate: {
                      kind: "instanceStateEquals",
                      field: "reviewIsStale",
                      value: true,
                    },
                  },
                ],
              },
              transitionTo: "accepting",
            },
            {
              id: "accept_anyway",
              label: "Accept anyway",
              variant: "destructive",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "taskOutputEquals",
                    task: "review",
                    path: "output.verdict",
                    value: "changes_requested",
                  },
                  {
                    kind: "not",
                    gate: {
                      kind: "instanceStateEquals",
                      field: "reviewIsStale",
                      value: true,
                    },
                  },
                ],
              },
              transitionTo: "accepting",
            },
            {
              id: "update_changes",
              label: "Update work",
              variant: "secondary",
              gate: {
                kind: "taskOutputEquals",
                task: "review",
                path: "output.verdict",
                value: "changes_requested",
              },
              transitionTo: "in_progress",
            },
            {
              id: "new_changes",
              label: "New attempt",
              variant: "secondary",
              gate: {
                kind: "taskOutputEquals",
                task: "review",
                path: "output.verdict",
                value: "changes_requested",
              },
              // The engine starts a fresh attempt: it bumps the instance's
              // attempt counter (the next prepare_worktree and review-package
              // persist run under attempt-2, attempt-3, ...) and discards the
              // abandoned worktree. The old attempt's branch stays identifiable.
              newAttempt: true,
              transitionTo: "ready",
            },
            {
              id: "restart_review",
              label: "Retry review",
              variant: "secondary",
              gate: { kind: "taskError", task: "review" },
              transitionTo: "running_review",
            },
            {
              id: "re_review",
              label: "Re-review",
              variant: "secondary",
              // A stale review must be re-built against the current integration
              // head (reviewing runs build_review_package), otherwise re-running
              // the reviewer on the same package keeps the reviewIsStale flag
              // set and accept stays blocked forever.
              gate: {
                kind: "instanceStateEquals",
                field: "reviewIsStale",
                value: true,
              },
              transitionTo: "reviewing",
            },
          ],
        },
        {
          id: "accepting",
          label: "Accepting",
          category: "active",
          tasks: [
            {
              id: "mergeWork",
              label: "Merge work",
              role: "operation",
              operations: ["merge_branch"],
            },
          ],
          autoTransitions: [
            {
              to: "done",
              gate: { kind: "taskSuccess", task: "mergeWork" },
            },
            {
              // Merge failure returns to reviewed with the attempt and its
              // worktree preserved so the user can retry or re-review.
              to: "reviewed",
              gate: { kind: "taskError", task: "mergeWork" },
            },
          ],
        },
        {
          id: "done",
          label: "Done",
          category: "terminal",
        },
        {
          id: "unfulfillable",
          label: "Unfulfillable",
          category: "error",
          tasks: [
            {
              id: "coordinate",
              label: "Analyze handover",
              role: "ai-task",
              workspacePath: "@instance:worktreePath",
              tools: ["read_file", "search_code"],
              systemPromptRef: "./cards/prompts/coordinator.ts",
            },
          ],
          actions: [
            {
              id: "remediate",
              label: "Apply remediation",
              variant: "primary",
              gate: { kind: "taskSuccess", task: "coordinate" },
              transitionTo: "ready",
            },
            {
              id: "archive_card",
              label: "Archive",
              variant: "secondary",
              transitionTo: "done",
            },
          ],
        },
      ],
    },
    // ── integration: fast-forward the target branch on demand ──
    {
      id: "integration",
      label: "Integration",
      description:
        "Fast-forward the target branch to the integration branch on demand.",
      ui: { view: "list" },
      instanceState: [],
      initialState: "ready",
      terminalStates: ["integrated"],
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
              gate: { kind: "noRunningTask" },
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
              role: "operation",
              // Record the flow's domain state on the integration branch first
              // so the fast-forward can bring it into the target branch cleanly.
              operations: ["commit_flow_state"],
            },
            {
              id: "integrate",
              label: "Fast-forward target branch",
              role: "operation",
              operations: ["fast_forward_target_branch"],
            },
          ],
          autoTransitions: [
            {
              to: "integrated",
              gate: {
                kind: "and",
                gates: [
                  { kind: "taskSuccess", task: "commitState" },
                  { kind: "taskSuccess", task: "integrate" },
                ],
              },
            },
            {
              to: "ready",
              gate: { kind: "taskError", task: "integrate" },
            },
          ],
        },
        {
          id: "integrated",
          label: "Integrated",
          category: "terminal",
        },
      ],
    },
  ],
  actions: [
    {
      id: "add_idea",
      label: "Add idea",
      variant: "primary",
      createInstance: {
        workflowId: "ideas",
        fields: [
          {
            key: "title",
            label: "Title",
            type: "string",
            required: true,
            hint: "A short statement of the idea.",
          },
          { key: "brief", label: "Brief", type: "string" },
        ],
      },
    },
    {
      id: "revise_requirements",
      label: "Revise requirements",
      variant: "secondary",
      dispatchToAll: { workflowId: "requirements", actionId: "start" },
    },
    {
      id: "integrate",
      label: "Integrate",
      variant: "secondary",
      dispatchToAll: { workflowId: "integration", actionId: "integrate" },
    },
  ],
  edges: [
    {
      fromWorkflow: "onboarding",
      fromStates: ["complete"],
      toWorkflow: "requirements",
    },
    {
      fromWorkflow: "onboarding",
      fromStates: ["complete"],
      toWorkflow: "integration",
    },
    {
      fromWorkflow: "ideas",
      fromStates: ["submitted"],
      toWorkflow: "requirements",
    },
    {
      fromWorkflow: "requirements",
      fromStates: ["accepted"],
      toWorkflow: "cards",
      // Fan out: one cards instance per planned card. The planner's structured
      // output is the parsed requirements_plan_complete arguments; each card is
      // already shaped — cardSpec (the card's own fields) plus dependencies.
      fanOut: {
        task: "plan",
        path: "output.cards",
        fields: {
          cardSpec: { kind: "itemPath", path: "cardSpec" },
          dependsOn: { kind: "itemPath", path: "dependencies" },
        },
      },
    },
  ],
};
