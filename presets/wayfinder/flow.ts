import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "wayfinder",
  label: "Wayfinder",
  description:
    "Chart a foggy effort into decision tickets, resolve them one at a time, then build.",
  configSchema: [
    {
      key: "destination",
      label: "Destination",
      type: "textarea",
      required: true,
      hint: "What does reaching the end of this effort look like? One or two lines — the spec, decision, or change this map is finding its way to. Every session orients to it before choosing a ticket.",
      placeholder: "e.g. A routing-layer spec, reviewed and locked",
    },
    {
      key: "basePath",
      label: "Base path",
      type: "string",
      hint: "The repository wayfinder is bound to — charting and build sessions read and write code here. Leave empty to work in the current directory.",
      placeholder: "e.g. . or a repo path",
    },
  ],
  domainDir: ".wayfinder",
  // Declarative theme: clear sky blue accent, mountain emblem — "clearing the
  // fog" matches wayfinder's chart-fog-then-build workflows. queen-bee /
  // honeycomb stay on the default golden. The served component modules (the
  // custom cards, workflow views, and render kinds) are refs — standalone
  // module-set files linted/typechecked by the gate and served stripped.
  ui: {
    theme: { accent: "#4a9fe0", emblem: "\u25b2" },
    kinds: [
      {
        kind: "findings-report",
        contract: {
          props: [
            { name: "findings", type: "string", scope: "output" },
            { name: "sources", type: "string[]", scope: "output" },
          ],
        },
      },
      {
        kind: "prototype-decision",
        contract: {
          props: [
            { name: "decision", type: "string", scope: "output" },
            { name: "gist", type: "string", scope: "output" },
            { name: "artifactPath", type: "string", scope: "output" },
          ],
        },
      },
      {
        kind: "plan-tickets",
        contract: {
          props: [{ name: "tickets", type: "array", scope: "output" }],
        },
      },
      {
        kind: "review-findings",
        contract: {
          props: [
            { name: "verdict", type: "string", scope: "output" },
            { name: "findings", type: "array", scope: "output" },
          ],
        },
      },
    ],
    components: {
      "ticket-card": { ref: "./ui/ticket-card.ts" },
      "build-card": { ref: "./ui/build-card.ts" },
      "build-item-card": { ref: "./ui/build-item-card.ts" },
      "charting-card": { ref: "./ui/charting-card.ts" },
      "expedition-map": { ref: "./ui/expedition-map.ts" },
      "frontier-board": { ref: "./ui/frontier-board.ts" },
      "build-pipeline": { ref: "./ui/build-pipeline.ts" },
      "findings-report": { ref: "./ui/findings-report.ts" },
      "prototype-decision": { ref: "./ui/prototype-decision.ts" },
      "plan-tickets": { ref: "./ui/plan-tickets.ts" },
      "review-findings": { ref: "./ui/review-findings.ts" },
    },
  },
  tools: [
    {
      id: "submit_map",
      ref: "./tools/submit-map.ts",
      writes: ["destination", "notes"],
    },
    {
      id: "submit_spec",
      ref: "./tools/submit-spec.ts",
      writes: ["spec"],
    },
  ],
  operations: [
    {
      id: "settle_chart",
      ref: "./charting/ops/settle-chart.ts",
    },
    {
      id: "normalize_ticket",
      ref: "./ticket/ops/normalize-ticket.ts",
      writes: ["title", "question", "type", "dependsOn"],
    },
    {
      id: "prepare_prototype_workspace",
      ref: "./ticket/ops/prepare-prototype-workspace.ts",
    },
    {
      id: "assemble_resolution",
      ref: "./ticket/ops/assemble-resolution.ts",
    },
    {
      id: "persist_research_findings",
      ref: "./ticket/ops/persist-research-findings.ts",
    },
    {
      id: "finalize_spec",
      ref: "./build/ops/finalize-spec.ts",
    },
    {
      id: "persist_build_plan",
      ref: "./build/ops/persist-build-plan.ts",
    },
    {
      id: "prepare_build_workspace",
      ref: "./build/ops/prepare-build-workspace.ts",
    },
    {
      id: "merge_build_work",
      ref: "./build/ops/merge-build-work.ts",
    },
  ],
  workflows: [
    {
      id: "charting",
      label: "Charting",
      description:
        "Name the destination, surface the decision frontier, then chart the map.",
      ui: {
        view: "list",
        instanceComponent: "charting-card",
        workflowComponent: "expedition-map",
      },
      instanceState: [
        {
          field: "destination",
          type: "string",
        },
        {
          field: "notes",
          type: "string",
        },
      ],
      terminalStates: ["charted"],
      states: [
        {
          id: "no_session",
          label: "No Session",
          category: "initial",
          actions: [
            {
              id: "start_charting",
              label: "Start charting",
              variant: "primary",
              gate: {
                kind: "noRunningTask",
              },
              transitionTo: "naming",
            },
          ],
        },
        {
          id: "naming",
          label: "Naming",
          category: "active",
          description: "Sharpen the destination and settle standing notes.",
          tasks: [
            {
              id: "nameSession",
              label: "Naming session",
              role: "ai-chat",
              startOnUserInput: true,
              // The creation-time destination opens the session as its first
              // user message (the user can add more); the session sharpens it.
              inputFromInstanceState: "destination",
              tools: [
                "list_directory",
                "read_file",
                "search_code",
                "submit_map",
              ],
              systemPromptRef: "./charting/prompts/naming.ts",
            },
          ],
          actions: [
            {
              id: "done",
              label: "Done",
              variant: "primary",
              completesRunningTask: true,
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "frontier",
            },
            {
              id: "cancel",
              label: "Cancel",
              variant: "secondary",
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "no_session",
            },
          ],
        },
        {
          id: "frontier",
          label: "Frontier",
          category: "active",
          description:
            "Surface open decisions and first steps across the whole space.",
          tasks: [
            {
              id: "settleChart",
              label: "Settle destination and write map",
              role: "operation",
              operations: ["settle_chart"],
              persist: {
                path: "map.md",
              },
            },
            {
              id: "frontierSession",
              label: "Frontier session",
              role: "ai-chat",
              startOnUserInput: true,
              // The settled destination opens the session as its first user
              // message, so the frontier survey starts from the charted map
              // (not a cold, empty session after the naming Done).
              inputFromInstanceState: "destination",
              tools: ["list_directory", "read_file", "search_code"],
              systemPromptRef: "./charting/prompts/frontier.ts",
            },
          ],
          actions: [
            {
              id: "done",
              label: "Done",
              variant: "primary",
              completesRunningTask: true,
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "charted",
            },
            {
              id: "cancel",
              label: "Cancel",
              variant: "secondary",
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "naming",
            },
          ],
        },
        {
          id: "charted",
          label: "Charted",
          category: "terminal",
          description:
            "The map is charted. Add tickets, graduate fog, resolve the frontier, then Start build.",
        },
      ],
      initial: "naming",
    },
    {
      id: "ticket",
      label: "Ticket",
      description:
        "A decision ticket: graduated from fog, claimed by type, resolved to a recorded decision.",
      instance: {
        title: "title",
      },
      ui: {
        view: "board",
        instanceComponent: "ticket-card",
        workflowComponent: "frontier-board",
        columns: [
          {
            id: "fog",
            label: "Fog",
            states: ["fog"],
          },
          {
            id: "frontier",
            label: "Frontier",
            states: ["ready"],
          },
          {
            id: "resolving",
            label: "Resolving",
            states: [
              "resolving_research",
              "resolving_prototype",
              "resolving_grilling",
              "resolving_task",
              "resolving_task_hitl",
              "recording",
            ],
          },
          {
            id: "closed",
            label: "Closed",
            states: ["closed", "out_of_scope"],
          },
        ],
      },
      display: {
        fields: [
          {
            path: "title",
            label: "Title",
          },
          {
            path: "question",
            label: "Question",
          },
          {
            path: "type",
            label: "Type",
          },
          {
            path: "dependsOn",
            label: "Blocks on",
          },
        ],
      },
      instanceState: [
        {
          field: "title",
          type: "string",
        },
        {
          field: "question",
          type: "string",
        },
        {
          field: "type",
          type: "string",
        },
        {
          field: "dependsOn",
          type: "string[]",
        },
        {
          field: "brief",
          type: "string",
        },
        {
          field: "hitl",
          type: "boolean",
        },
        {
          field: "worktreePath",
          type: "string",
        },
        {
          field: "branchName",
          type: "string",
        },
      ],
      terminalStates: ["closed", "out_of_scope"],
      states: [
        {
          id: "fog",
          label: "Fog",
          category: "initial",
          description: "Not yet specified — the question is still foggy.",
          tasks: [
            {
              id: "normalizeTicket",
              label: "Normalize ticket",
              role: "operation",
              operations: ["normalize_ticket"],
            },
          ],
          actions: [
            {
              id: "graduate",
              label: "Graduate to ready",
              variant: "primary",
              gate: {
                kind: "noRunningTask",
              },
              transitionTo: "ready",
            },
            {
              id: "rule_out",
              label: "Rule out of scope",
              variant: "destructive",
              transitionTo: "out_of_scope",
            },
          ],
        },
        {
          id: "ready",
          label: "Ready",
          category: "active",
          description: "Claimable — the frontier.",
          actions: [
            {
              id: "claim_research",
              label: "Claim for research",
              variant: "primary",
              dependsOnState: "closed",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "instanceStateEquals",
                    field: "type",
                    value: "research",
                  },
                  {
                    kind: "file",
                    ref: "./gates/blockers-closed.ts",
                  },
                ],
              },
              transitionTo: "resolving_research",
            },
            {
              id: "claim_prototype",
              label: "Claim for prototype",
              variant: "primary",
              dependsOnState: "closed",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "instanceStateEquals",
                    field: "type",
                    value: "prototype",
                  },
                  {
                    kind: "file",
                    ref: "./gates/blockers-closed.ts",
                  },
                ],
              },
              transitionTo: "resolving_prototype",
            },
            {
              id: "claim_grilling",
              label: "Claim for grilling",
              variant: "primary",
              dependsOnState: "closed",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "instanceStateEquals",
                    field: "type",
                    value: "grilling",
                  },
                  {
                    kind: "file",
                    ref: "./gates/blockers-closed.ts",
                  },
                ],
              },
              transitionTo: "resolving_grilling",
            },
            {
              id: "claim_task",
              label: "Claim as task",
              variant: "primary",
              dependsOnState: "closed",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "instanceStateEquals",
                    field: "type",
                    value: "task",
                  },
                  {
                    kind: "not",
                    gate: {
                      kind: "instanceStateEquals",
                      field: "hitl",
                      value: true,
                    },
                  },
                  {
                    kind: "file",
                    ref: "./gates/blockers-closed.ts",
                  },
                ],
              },
              transitionTo: "resolving_task",
            },
            {
              id: "claim_task_hitl",
              label: "Claim as task (session)",
              variant: "primary",
              dependsOnState: "closed",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "instanceStateEquals",
                    field: "type",
                    value: "task",
                  },
                  {
                    kind: "instanceStateEquals",
                    field: "hitl",
                    value: true,
                  },
                  {
                    kind: "file",
                    ref: "./gates/blockers-closed.ts",
                  },
                ],
              },
              transitionTo: "resolving_task_hitl",
            },
            {
              id: "rule_out",
              label: "Rule out of scope",
              variant: "destructive",
              transitionTo: "out_of_scope",
            },
          ],
        },
        {
          id: "resolving_research",
          label: "Resolving — research",
          category: "active",
          tasks: [
            {
              id: "research",
              label: "Run research",
              role: "ai-task",
              tools: [
                "read_file",
                "list_directory",
                "search_code",
                "web_fetch",
              ],
              render: {
                kind: "findings-report",
                props: { findings: "findings", sources: "sources" },
              },
              completionOutput: [
                {
                  field: "question",
                  type: "string",
                  description: "The ticket question.",
                },
                {
                  field: "findings",
                  type: "string",
                  description: "The full cited research report in markdown.",
                },
                {
                  field: "sources",
                  type: "string[]",
                  description: "Primary-source URLs consulted.",
                },
              ],
              systemPromptRef: "./ticket/prompts/research.ts",
            },
            {
              id: "persistFindings",
              label: "Persist research findings",
              role: "operation",
              operations: ["persist_research_findings"],
              persist: {
                path: "research/{instanceId}.md",
              },
            },
          ],
          autoTransitions: [
            {
              to: "recording",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "taskSuccess",
                    task: "research",
                  },
                  {
                    kind: "taskSuccess",
                    task: "persistFindings",
                  },
                ],
              },
            },
          ],
          actions: [
            {
              id: "retry",
              label: "Retry research",
              variant: "secondary",
              gate: {
                kind: "taskError",
                task: "research",
              },
              transitionTo: "resolving_research",
            },
            {
              id: "cancel",
              label: "Cancel",
              variant: "secondary",
              transitionTo: "ready",
            },
          ],
        },
        {
          id: "resolving_prototype",
          label: "Resolving — prototype",
          category: "active",
          tasks: [
            {
              id: "preparePrototype",
              label: "Prepare prototype workspace",
              role: "operation",
              operations: ["prepare_prototype_workspace"],
            },
            {
              id: "prototypeSession",
              label: "Prototype session",
              role: "ai-chat",
              startOnUserInput: true,
              workspacePath: "@instance:worktreePath",
              render: {
                kind: "prototype-decision",
                props: {
                  decision: "completion.decision",
                  gist: "completion.gist",
                  artifactPath: "completion.artifactPath",
                },
              },
              tools: [
                "read_file",
                "write_file",
                "run_command",
                "list_directory",
              ],
              completionOutput: [
                {
                  field: "decision",
                  type: "string",
                  description: "The captured answer to the design question.",
                },
                {
                  field: "gist",
                  type: "string",
                  description: "The one-line takeaway.",
                },
                {
                  field: "artifactPath",
                  type: "string",
                  description:
                    "Relative path of the throwaway artifact kept as a primary source.",
                },
              ],
              systemPromptRef: "./ticket/prompts/prototype.ts",
            },
          ],
          autoTransitions: [
            {
              to: "recording",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "taskSuccess",
                    task: "preparePrototype",
                  },
                  {
                    kind: "taskSuccess",
                    task: "prototypeSession",
                  },
                ],
              },
            },
            {
              to: "ready",
              gate: {
                kind: "taskError",
                task: "preparePrototype",
              },
            },
          ],
          actions: [
            {
              id: "done",
              label: "Done",
              variant: "primary",
              completesRunningTask: true,
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "recording",
            },
            {
              id: "cancel",
              label: "Cancel",
              variant: "secondary",
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "ready",
            },
          ],
        },
        {
          id: "resolving_grilling",
          label: "Resolving — grilling",
          category: "active",
          tasks: [
            {
              id: "grillSession",
              label: "Grilling session",
              role: "ai-chat",
              startOnUserInput: true,
              render: {
                kind: "prototype-decision",
                props: {
                  decision: "completion.decision",
                  gist: "completion.gist",
                },
              },
              tools: [
                "read_file",
                "list_directory",
                "search_code",
                "create_instance",
              ],
              completionOutput: [
                {
                  field: "decision",
                  type: "string",
                  description: "The sharp decision reached.",
                },
                {
                  field: "gist",
                  type: "string",
                  description:
                    "A one-to-two sentence summary of the shared understanding.",
                },
              ],
              systemPromptRef: "./ticket/prompts/grilling.ts",
            },
          ],
          autoTransitions: [
            {
              to: "recording",
              gate: {
                kind: "taskSuccess",
                task: "grillSession",
              },
            },
          ],
          actions: [
            {
              id: "done",
              label: "Done",
              variant: "primary",
              completesRunningTask: true,
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "recording",
            },
            {
              id: "cancel",
              label: "Cancel",
              variant: "secondary",
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "ready",
            },
          ],
        },
        {
          id: "resolving_task",
          label: "Resolving — task",
          category: "active",
          tasks: [
            {
              id: "taskSession",
              label: "Run task",
              role: "ai-task",
              render: {
                kind: "prototype-decision",
                props: {
                  decision: "decision",
                  gist: "gist",
                },
              },
              tools: [
                "read_file",
                "list_directory",
                "search_code",
                "run_command",
                "write_file",
              ],
              completionOutput: [
                {
                  field: "decision",
                  type: "string",
                  description:
                    "What was done, or the blocker if it could not proceed.",
                },
                {
                  field: "gist",
                  type: "string",
                  description: "The verification that was run.",
                },
              ],
              systemPromptRef: "./ticket/prompts/task-afk.ts",
            },
          ],
          autoTransitions: [
            {
              to: "recording",
              gate: {
                kind: "taskSuccess",
                task: "taskSession",
              },
            },
          ],
          actions: [
            {
              id: "retry",
              label: "Retry task",
              variant: "secondary",
              gate: {
                kind: "taskError",
                task: "taskSession",
              },
              transitionTo: "resolving_task",
            },
            {
              id: "cancel",
              label: "Cancel",
              variant: "secondary",
              transitionTo: "ready",
            },
          ],
        },
        {
          id: "resolving_task_hitl",
          label: "Resolving — task session",
          category: "active",
          tasks: [
            {
              id: "taskHitlSession",
              label: "Task session",
              role: "ai-chat",
              startOnUserInput: true,
              render: {
                kind: "prototype-decision",
                props: {
                  decision: "completion.decision",
                  gist: "completion.gist",
                },
              },
              tools: [
                "read_file",
                "list_directory",
                "search_code",
                "run_command",
              ],
              completionOutput: [
                {
                  field: "decision",
                  type: "string",
                  description: "The outcome of the task.",
                },
                {
                  field: "gist",
                  type: "string",
                  description: "A short record of what the human carried out.",
                },
              ],
              systemPromptRef: "./ticket/prompts/task-hitl.ts",
            },
          ],
          autoTransitions: [
            {
              to: "recording",
              gate: {
                kind: "taskSuccess",
                task: "taskHitlSession",
              },
            },
          ],
          actions: [
            {
              id: "done",
              label: "Done",
              variant: "primary",
              completesRunningTask: true,
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "recording",
            },
            {
              id: "cancel",
              label: "Cancel",
              variant: "secondary",
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "ready",
            },
          ],
        },
        {
          id: "recording",
          label: "Recording",
          category: "active",
          tasks: [
            {
              id: "assembleResolution",
              label: "Assemble decision record",
              role: "operation",
              operations: ["assemble_resolution"],
              persist: {
                path: "decisions/{instanceId}.md",
              },
            },
          ],
          autoTransitions: [
            {
              to: "closed",
              gate: {
                kind: "taskSuccess",
                task: "assembleResolution",
              },
            },
            {
              to: "ready",
              gate: {
                kind: "taskError",
                task: "assembleResolution",
              },
            },
          ],
        },
        {
          id: "closed",
          label: "Closed",
          category: "terminal",
          description: "A Decisions-so-far entry.",
        },
        {
          id: "out_of_scope",
          label: "Out of scope",
          category: "terminal",
          description: "Closed — never graduates.",
        },
      ],
      initial: "fog",
    },
    {
      id: "build",
      label: "Build",
      description:
        "The implementation phase: spec the collapsed decisions, plan tracer-bullet tickets, quiz the breakdown, then fan out build items.",
      ui: {
        view: "list",
        instanceComponent: "build-card",
        workflowComponent: "build-pipeline",
      },
      instanceState: [
        {
          field: "spec",
          type: "string",
        },
      ],
      terminalStates: ["accepted"],
      states: [
        {
          id: "specing",
          label: "Specing",
          category: "initial",
          description:
            "Synthesize the decision records into a spec and check the seams with the human.",
          tasks: [
            {
              id: "specSession",
              label: "Spec session",
              role: "ai-chat",
              startOnUserInput: true,
              tools: [
                "list_directory",
                "read_file",
                "search_code",
                "submit_spec",
              ],
              systemPromptRef: "./build/prompts/specing.ts",
            },
          ],
          actions: [
            {
              id: "done",
              label: "Done",
              variant: "primary",
              completesRunningTask: true,
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "hasRunningTask",
                  },
                  {
                    kind: "file",
                    ref: "./gates/spec-recorded.ts",
                  },
                ],
              },
              transitionTo: "planned",
            },
            {
              id: "restart",
              label: "Restart session",
              variant: "secondary",
              gate: {
                kind: "hasRunningTask",
              },
              transitionTo: "specing",
            },
          ],
        },
        {
          id: "planned",
          label: "Planned",
          category: "active",
          tasks: [
            {
              id: "finalizeSpec",
              label: "Write spec document",
              role: "operation",
              operations: ["finalize_spec"],
              persist: {
                path: "spec.md",
              },
            },
            {
              id: "plan",
              label: "Run planner",
              role: "ai-task",
              tools: ["read_file", "search_code"],
              render: {
                kind: "plan-tickets",
                props: { tickets: "tickets" },
              },
              completionOutput: [
                {
                  field: "tickets",
                  type: "object[]",
                  description:
                    "One entry per tracer-bullet build ticket: { title, description, acceptanceCriteria, dependsOn }.",
                },
              ],
              inputFromInstanceState: "spec",
              systemPromptRef: "./build/prompts/planner.ts",
            },
          ],
          autoTransitions: [
            {
              to: "proposed",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "taskSuccess",
                    task: "finalizeSpec",
                  },
                  {
                    kind: "taskSuccess",
                    task: "plan",
                  },
                ],
              },
            },
          ],
        },
        {
          id: "proposed",
          label: "Proposed",
          category: "active",
          description:
            "The draft build plan — quiz the breakdown before the fan-out.",
          actions: [
            {
              id: "accept_proposal",
              label: "Accept and create build items",
              variant: "primary",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "noRunningTask",
                  },
                  {
                    kind: "taskSuccess",
                    task: "plan",
                  },
                ],
              },
              transitionTo: "finalizing",
            },
            {
              id: "request_revision",
              label: "Request revision",
              variant: "secondary",
              gate: {
                kind: "and",
                gates: [
                  {
                    kind: "noRunningTask",
                  },
                  {
                    kind: "taskSuccess",
                    task: "plan",
                  },
                ],
              },
              transitionTo: "specing",
            },
          ],
        },
        {
          id: "finalizing",
          label: "Finalizing",
          category: "active",
          tasks: [
            {
              id: "persistPlan",
              label: "Persist build plan",
              role: "operation",
              operations: ["persist_build_plan"],
              persist: {
                path: "build-plan.md",
              },
            },
          ],
          autoTransitions: [
            {
              to: "accepted",
              gate: {
                kind: "taskSuccess",
                task: "persistPlan",
              },
            },
          ],
        },
        {
          id: "accepted",
          label: "Accepted",
          category: "terminal",
          description: "The plan is accepted; build items fan out.",
        },
      ],
      initial: "specing",
    },
    {
      id: "buildItem",
      label: "Build Item",
      description:
        "One build ticket: worker implements in an isolated workspace, reviewer audits on two axes.",
      instance: {
        title: "ticket.title",
      },
      ui: {
        view: "board",
        instanceComponent: "build-item-card",
      },
      display: {
        fields: [
          {
            path: "ticket",
            label: "Build ticket",
            render: {
              kind: "card",
              props: {
                title: "title",
                description: "description",
                bullets: "acceptanceCriteria",
              },
            },
          },
        ],
      },
      instanceState: [
        {
          field: "ticket",
          type: "object",
        },
        {
          field: "dependsOn",
          type: "string[]",
        },
        {
          field: "worktreePath",
          type: "string",
        },
        {
          field: "branchName",
          type: "string",
        },
      ],
      terminalStates: ["done"],
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [
            {
              id: "run",
              label: "Run build item",
              variant: "primary",
              maxWorkflowInstancesInTarget: 3,
              dependsOnState: "done",
              gate: {
                kind: "noRunningTask",
              },
              transitionTo: "working",
            },
          ],
        },
        {
          id: "working",
          label: "Working",
          category: "active",
          tasks: [
            {
              id: "prepareWorkspace",
              label: "Prepare workspace",
              role: "operation",
              operations: ["prepare_build_workspace"],
            },
          ],
          autoTransitions: [
            {
              to: "unfulfillable",
              gate: {
                kind: "taskError",
                task: "prepareWorkspace",
              },
            },
            {
              to: "running",
              gate: {
                kind: "taskSuccess",
                task: "prepareWorkspace",
              },
            },
          ],
        },
        {
          id: "running",
          label: "Running",
          category: "active",
          tasks: [
            {
              id: "runAgent",
              label: "Run build worker",
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
                  description: '"implemented" or "blocked".',
                },
                {
                  field: "summary",
                  type: "string",
                  description:
                    "What was done and how it was verified, or the precise blocker.",
                },
              ],
              inputFromInstanceState: "ticket",
              systemPromptRef: "./build/prompts/worker.ts",
            },
          ],
          autoTransitions: [
            {
              to: "unfulfillable",
              gate: {
                kind: "taskOutputEquals",
                task: "runAgent",
                path: "output.completion.outcome",
                value: "blocked",
              },
            },
            {
              to: "reviewing",
              gate: {
                kind: "taskOutputEquals",
                task: "runAgent",
                path: "output.completion.outcome",
                value: "implemented",
              },
            },
          ],
          actions: [
            {
              id: "retry",
              label: "Retry worker",
              variant: "secondary",
              gate: {
                kind: "taskError",
                task: "runAgent",
              },
              transitionTo: "running",
            },
          ],
        },
        {
          id: "reviewing",
          label: "Reviewing",
          category: "active",
          tasks: [
            {
              id: "review",
              label: "Run code review",
              role: "ai-task",
              workspacePath: "@instance:worktreePath",
              render: {
                kind: "review-findings",
                props: { verdict: "verdict", findings: "findings" },
              },
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
                  field: "findings",
                  type: "object[]",
                  description:
                    "Each finding: axis, severity, detail, and evidence.",
                },
              ],
              systemPromptRef: "./build/prompts/reviewer.ts",
            },
          ],
          autoTransitions: [
            {
              to: "accepting",
              gate: {
                kind: "taskOutputEquals",
                task: "review",
                path: "output.verdict",
                value: "approved",
              },
            },
            {
              to: "working",
              gate: {
                kind: "taskOutputEquals",
                task: "review",
                path: "output.verdict",
                value: "changes_requested",
              },
            },
          ],
          actions: [
            {
              id: "retry_review",
              label: "Retry review",
              variant: "secondary",
              gate: {
                kind: "taskError",
                task: "review",
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
              label: "Merge accepted work",
              role: "operation",
              operations: ["merge_build_work"],
            },
          ],
          autoTransitions: [
            {
              to: "done",
              gate: {
                kind: "taskSuccess",
                task: "mergeWork",
              },
            },
            {
              to: "reviewing",
              gate: {
                kind: "taskError",
                task: "mergeWork",
              },
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
          actions: [
            {
              id: "retry",
              label: "Retry build item",
              variant: "primary",
              transitionTo: "working",
            },
            {
              id: "archive",
              label: "Archive",
              variant: "secondary",
              transitionTo: "done",
            },
          ],
        },
      ],
      initial: "ready",
    },
  ],
  actions: [
    {
      id: "add_ticket",
      label: "Add ticket",
      variant: "primary",
      gate: {
        kind: "file",
        ref: "./gates/frontier-charted.ts",
      },
      createInstance: {
        workflowId: "ticket",
        fields: [
          {
            key: "title",
            label: "Title",
            type: "string",
            required: true,
          },
          {
            key: "question",
            label: "Question",
            type: "string",
          },
          {
            key: "type",
            label: "Type",
            type: "string",
            required: true,
            hint: "How the ticket resolves: research (AFK), prototype, grilling, or task.",
            options: ["research", "prototype", "grilling", "task"],
          },
          {
            key: "dependsOn",
            label: "Blocks on",
            type: "string",
            hint: "Comma-separated ticket ids",
          },
          {
            key: "hitl",
            label: "HITL session (task tickets)",
            type: "boolean",
            hint: "Resolve a task ticket through a live session instead of an AFK run.",
          },
        ],
      },
    },
    {
      id: "add_fog_entry",
      label: "Add fog entry",
      variant: "secondary",
      gate: {
        kind: "file",
        ref: "./gates/frontier-charted.ts",
      },
      createInstance: {
        workflowId: "ticket",
        fields: [
          {
            key: "brief",
            label: "Brief",
            type: "string",
            required: true,
            hint: "A vague statement to be sharpened or ruled out.",
          },
        ],
      },
    },
    {
      id: "start_build",
      label: "Start build",
      variant: "primary",
      gate: {
        kind: "file",
        ref: "./gates/map-is-clear.ts",
      },
      createInstance: {
        workflowId: "build",
        fields: [],
      },
    },
  ],
  edges: [
    {
      fromWorkflow: "build",
      fromStates: ["accepted"],
      toWorkflow: "buildItem",
      fanOut: {
        task: "plan",
        path: "output.tickets",
        fields: {
          ticket: {
            kind: "itemPath",
            path: "",
          },
          dependsOn: {
            kind: "itemPath",
            path: "dependsOn",
          },
        },
      },
    },
  ],
};
