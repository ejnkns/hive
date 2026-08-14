/** The patterns rung of the flow-authoring knowledge: tested lifecycle shapes
 * the model copies. One full exemplar (structured-intake, embedded as a
 * validated definition) plus compact sketches for the rest — each sketch shows
 * only the distinctive state/task/edge/action shape, not the full data. The
 * authoring flow asks the model to pick a pattern before writing the
 * definition; the validator keeps every copy honest. */

import type { FlowDefinition } from "workflow-engine/workflow-types";

export type FlowPattern = {
  id: string;
  name: string;
  when: string;
  // One pattern carries its full validated definition as the copyable exemplar.
  exemplar?: FlowDefinition;
  // The others carry a compact shape sketch (the distinctive parts only).
  sketch?: string;
};

// The reference exemplar: a domain-neutral structured intake — an ai-task that
// classifies an item, a patch op recording the returned fields (failing when
// the agent skipped the contract), taskError gates routing to a retry state,
// and a flow-level createInstance action. The model copies this SHAPE and
// renames the nouns for its domain.
export const STRUCTURED_INTAKE_EXEMPLAR: FlowDefinition = {
  id: "intake",
  label: "Item Intake",
  description: "Classify incoming items into a category and tags.",
  configSchema: [],
  workflows: [
    {
      id: "items",
      label: "Items",
      instance: { title: "description" },
      display: {
        fields: [
          { path: "description", label: "Description" },
          { path: "category", label: "Category" },
          { path: "tags", label: "Tags" },
        ],
      },
      instanceState: [
        { field: "description", type: "string" },
        { field: "category", type: "string" },
        { field: "tags", type: "string[]" },
      ],
      initial: "inbox",
      terminalStates: ["classified", "discarded"],
      states: [
        {
          id: "inbox",
          label: "Inbox",
          category: "initial",
          tasks: [
            {
              id: "classify",
              label: "Classify item",
              role: "ai-task",
              systemPrompt:
                "Classify the item into a category and relevant tags, then call the completion tool with both.",
              inputFromInstanceState: "description",
              completionOutput: [
                {
                  field: "category",
                  type: "string",
                  description: "Short category name",
                },
                {
                  field: "tags",
                  type: "string[]",
                  description: "Relevant tags",
                },
              ],
            },
            {
              id: "record",
              label: "Record classification",
              role: "operation",
              patch: {
                category: {
                  kind: "taskOutput",
                  task: "classify",
                  path: "output.category",
                },
                tags: {
                  kind: "taskOutput",
                  task: "classify",
                  path: "output.tags",
                },
              },
            },
          ],
          autoTransitions: [
            {
              to: "needs_review",
              gate: { kind: "taskError", task: "classify" },
            },
            {
              to: "needs_review",
              gate: { kind: "taskError", task: "record" },
            },
            {
              to: "classified",
              gate: { kind: "taskSuccess", task: "record" },
            },
          ],
        },
        {
          id: "needs_review",
          label: "Needs review",
          category: "active",
          actions: [
            {
              id: "retry",
              label: "Retry classification",
              variant: "primary",
              transitionTo: "inbox",
            },
            {
              id: "discard",
              label: "Discard item",
              variant: "destructive",
              transitionTo: "discarded",
            },
          ],
        },
        { id: "classified", label: "Classified", category: "terminal" },
        { id: "discarded", label: "Discarded", category: "terminal" },
      ],
    },
  ],
  actions: [
    {
      id: "add_item",
      label: "Add an item",
      variant: "primary",
      createInstance: {
        workflowId: "items",
        fields: [
          {
            key: "description",
            label: "Describe the item",
            type: "string",
            required: true,
          },
        ],
      },
    },
  ],
  edges: [],
};

// Compact shape sketches for the other tested patterns. Each shows only the
// part that makes the pattern what it is, with domain-neutral nouns.
const HUMAN_REVIEW_SKETCH = `human-review — a proposal a human must approve or reject:
  instanceState: [ { field: "title", type: "string" }, { field: "proposal", type: "string" } ]
  states:
    ready       (initial; action "start" primary → running)
    running     (active; ai-chat task with startOnUserInput: true, inputFromInstanceState: "title";
                 action "done" with completesRunningTask: true → reviewed)
    reviewed    (active; action "approve" primary → approved; action "reject" destructive → rejected)
    approved, rejected (terminals)
  the ai-chat transcript is the proposal; a patch op records output.content into the "proposal" field`;

const PIPELINE_FANOUT_SKETCH = `pipeline-fan-out — one workflow's output produces many instances of another:
  workflow planning: initial → done (terminal); task "planWork" (ai-task, systemPrompt, completionOutput
    [ { field: "items", type: "object[]", description: "one entry per item to create" } ])
  workflow items: never created by a human; an edge creates one instance per planned unit:
    { fromWorkflow: "planning", fromStates: ["done"], toWorkflow: "items",
      fanOut: { task: "planWork", path: "output.items",
                fields: { title: { kind: "itemPath", path: "title" }, dependsOn: { kind: "itemPath", path: "dependencies" } } } }
  the target workflow's tasks then read the item fields (title, ...) seeded onto each instance`;

const GIT_WORK_SKETCH = `git-backed work — work happens in a repository, with a worker and a reviewer:
  workflow items: instanceState includes a brief (the work assignment) plus the outcome;
    ready → running_agent → validating → reviewing → reviewed → accepting → done | unfulfillable
  the worker state runs tasks:
    prepare_worktree (operation) — an isolated worktree on a feature branch
    run_agent (ai-task, workspacePath: "@instance:worktreePath", tools: read_file/write_file/run_command/
      git_status/git_diff/git_log/commit_work, completionTool: "complete_task",
      inputFromInstanceState: "brief") — the agent does and commits the work
    then verify_workspace (operation, operationInputs.require: "committed") — the work must exist
  a reviewing state runs a reviewer ai-task with read-only tools and completionTool "complete_task";
  an accepting state runs merge_branch (operation) into the integration branch.
  the flow needs a basePath bound to the repo (configSchema with basePath, or an onboarding workflow
  that patches it via patch_flow_config).`;

// Custom logic — the blueprint-referenced modules: file references for gates,
// tools, operations, edge transforms, and output extractors. Tested end to end
// by the research-loop e2e (a custom gate deciding a transition + a custom
// websearch tool returning a shaped result).
const CUSTOM_LOGIC_SKETCH = `custom-logic — reference a file for anything the structured vocabulary can't express:
  flow level: "tools": [ { "id": "websearch", "ref": "./tools/websearch.ts" } ],
              "operations": [ { "id": "score", "ref": "./ops/score.ts" } ],
              "dependencies": [ "axios" ]   // external packages the files may import
  a transition's gate: { "kind": "file", "ref": "./gates/approved.ts" }  // the file exports (ctx) => boolean
  a task: "tools": ["websearch"] (the custom tool id) and "operations": ["score", { "ref": "./ops/annotate.ts" }]
  an operation task may declare "extract": { "ref": "./extractors/parse.ts", "fields": ["verdict"] } — a
    referenced output extractor that patches the declared instance-state fields
  an edge: "transform": { "ref": "./edges/to-summary.ts", "fields": ["title", "body"] } — the target fields
  the renderer emits a contract-typed stub per reference; implement the stub's named export (keep the
  name and contract) and generate again — hand edits are authoritative. A file gate reads the runtime
  gate context (ctx.workflowInstanceState), so keep its transition in a state whose tasks are all
  complete (auto-transitions evaluate after each task).
  example lifecycle: searching (ai-chat task with the custom tool) → extracting (extractor op) → done,
  where the transition out of extracting is gated by the referenced gate file.`;

export const FLOW_PATTERNS: FlowPattern[] = [
  {
    id: "structured-intake",
    name: "Structured intake",
    when: "users add items that an AI classifies, enriches, or triages into recorded fields, then items finish or need a human retry",
    exemplar: STRUCTURED_INTAKE_EXEMPLAR,
  },
  {
    id: "human-review",
    name: "Human review",
    when: "an AI produces a proposal, verdict, or session that a human must approve or reject",
    sketch: HUMAN_REVIEW_SKETCH,
  },
  {
    id: "pipeline-fanout",
    name: "Pipeline / fan-out",
    when: "one workflow's output creates many instances of another (a plan produces one item per planned unit)",
    sketch: PIPELINE_FANOUT_SKETCH,
  },
  {
    id: "git-work",
    name: "Git-backed work",
    when: "the work is code in a repository that must be committed, verified, and reviewed",
    sketch: GIT_WORK_SKETCH,
  },
  {
    id: "custom-logic",
    name: "Custom logic (referenced modules)",
    when: "a gate needs logic beyond the structured predicates, or the flow needs a custom tool, operation, edge transform, or output extractor (a research loop, a websearch, a scraper)",
    sketch: CUSTOM_LOGIC_SKETCH,
  },
];

export function renderPatternsPrompt(): string {
  const lines: string[] = [
    "## Patterns (pick the one that fits, then copy its shape)",
  ];
  for (const pattern of FLOW_PATTERNS) {
    lines.push("");
    lines.push(`### ${pattern.name} — when: ${pattern.when}`);
    if (pattern.exemplar) {
      lines.push(
        `A complete valid blueprint for this pattern:\n\`\`\`json\n${JSON.stringify(pattern.exemplar, null, 2)}\n\`\`\``
      );
    } else if (pattern.sketch) {
      lines.push(pattern.sketch);
    }
  }
  return lines.join("\n");
}
