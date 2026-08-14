# Flow Authoring — the Hive skill

The knowledge for designing Hive flow definitions. This document is rendered from the authoring knowledge modules (`server/src/server/flow-authoring/`), so it cannot drift from what the authoring session teaches the agent.

## How to design a flow (decisions, in order)

1. **Entities.** One workflow per entity the flow tracks — an item, a request, a record, a session, an order — whatever the domain's unit of work is. Each workflow is a lifecycle: an initial state where instances are born, active states where work happens, terminal states where instances finish. Per-instance data lives in `instanceState`; cross-entity data lives in flow-level state (`flowState`), never duplicated on instances.

2. **Who does the work.** A state's tasks run on entry:
   - `operation` — deterministic work: an engine op (`prepare_worktree`, `verify_workspace`, `merge_branch`, `patch_flow_config`, `commit_flow_state`, `validate_repo`) or a patch op that records another task's output into instanceState.
   - `ai-task` — one-shot AI work that RETURNS DATA. Give it a `systemPrompt` naming the job and the completion tool, seed it with `inputFromInstanceState`, and declare `completionOutput` with exactly the fields it must return. Record those fields with a sibling operation `patch` task.
   - `ai-chat` — a multi-turn AI session. Use `startOnUserInput: true` when a human talks with the agent (HITL); the session ends when the human clicks an action with `completesRunningTask: true`, or the agent calls its completion tool.

3. **How an ai-task returns data.**
   - `completionOutput: [{ field, type }]` — the agent must return exactly these fields; the compiler generates the completion tool; patches and gates read `output.<field>`. Use this whenever the flow must RECORD structured data (a category, a verdict, tags, a spec).
   - `completionTool: "complete_task"` — the agent returns `{ outcome, summary, rationale }`. Use only for "did you do the work" outcomes, never for domain data.
   - Neither — the transcript becomes the output. Use only for advice or prose that nobody records.

4. **How a human drives the flow.** `ManualAction` buttons on states; flow-level actions for creating instances (`createInstance`) or bulk dispatch (`dispatchToAll`). Variants: `primary` = the call to action, `destructive` = irreversible (discard/delete), `secondary`/default = neutral. Every instance needs a way to be created and a way to finish.

5. **How work flows between workflows.** Edges: when an instance of one workflow reaches a state you list, its task output transforms into a new instance of another workflow (`fields`) — or one instance per array item (`fanOut`). Use edges to build pipelines, never to duplicate data.

6. **Error handling — every flow needs an escape hatch.** Any ai-task or operation can fail. For every state with fallible tasks, add a needs-review/error state, gate `taskError` autoTransitions into it, and give it a retry action (transition back to the work state) and a discard action (transition to a terminal). The engine fails fast on ai-tasks with no system prompt and no input, so a state with no escape hatch becomes a stuck instance.

7. **UI.** Every workflow declares `instance: { title }` (and optionally `subtitle`) plus `display: { fields }` so instances show meaningful content — declare display fields ONLY for fields something actually writes. Choose `ui.view`: `board` (default, one column per state or per declared column), `list`, `document`, `chat`.

8. **Documents.** When a task produces a document (a specification, a review package, a report), declare `persist: { path }` so the output lands in the flow's domain root; the path supports `{instanceId}` and `{attempt}` substitution.

9. **Pick the pattern, don't improvise.** Match the request to one of the patterns below and copy its shape: structured intake, human review, pipeline/fan-out, git-backed work, or custom logic. The patterns are the tested shapes; the vocabulary is their language. Use whatever nouns fit the request's domain — the patterns and vocabulary are domain-agnostic.

10. **Custom logic beyond the structured vocabulary — reference a file.** When a gate needs comparisons the structured predicates can't express, or the flow needs a custom tool (websearch, a scraper), operation, edge transform, or output extractor, declare it as a definition-referenced module: flow-level `tools`/`operations` lists, a `{ kind: "file", ref }` gate, an edge `transform: { ref }`, or a task `extract: { ref }`. Implement the referenced file's named export (keep the name and contract the reference derives) and validate again — hand edits are authoritative. A referenced file may import engine primitives, the flow's own files, `node:` builtins, and packages declared in the definition's `dependencies`; anything else fails the gate with a readable finding. Keep a file-gate transition in a state whose tasks are all complete — auto-transitions evaluate after each task.

## Patterns (pick the one that fits, then copy its shape)

### Structured intake — when: users add items that an AI classifies, enriches, or triages into recorded fields, then items finish or need a human retry
A complete valid definition for this pattern:
```json
{
  "id": "intake",
  "label": "Item Intake",
  "description": "Classify incoming items into a category and tags.",
  "configSchema": [],
  "workflows": [
    {
      "id": "items",
      "label": "Items",
      "instance": {
        "title": "description"
      },
      "display": {
        "fields": [
          {
            "path": "description",
            "label": "Description"
          },
          {
            "path": "category",
            "label": "Category"
          },
          {
            "path": "tags",
            "label": "Tags"
          }
        ]
      },
      "instanceState": [
        {
          "field": "description",
          "type": "string"
        },
        {
          "field": "category",
          "type": "string"
        },
        {
          "field": "tags",
          "type": "string[]"
        }
      ],
      "initial": "inbox",
      "terminalStates": [
        "classified",
        "discarded"
      ],
      "states": [
        {
          "id": "inbox",
          "label": "Inbox",
          "category": "initial",
          "tasks": [
            {
              "id": "classify",
              "label": "Classify item",
              "role": "ai-task",
              "systemPrompt": "Classify the item into a category and relevant tags, then call the completion tool with both.",
              "inputFromInstanceState": "description",
              "completionOutput": [
                {
                  "field": "category",
                  "type": "string",
                  "description": "Short category name"
                },
                {
                  "field": "tags",
                  "type": "string[]",
                  "description": "Relevant tags"
                }
              ]
            },
            {
              "id": "record",
              "label": "Record classification",
              "role": "operation",
              "patch": {
                "category": {
                  "kind": "taskOutput",
                  "task": "classify",
                  "path": "output.category"
                },
                "tags": {
                  "kind": "taskOutput",
                  "task": "classify",
                  "path": "output.tags"
                }
              }
            }
          ],
          "autoTransitions": [
            {
              "to": "needs_review",
              "gate": {
                "kind": "taskError",
                "task": "classify"
              }
            },
            {
              "to": "needs_review",
              "gate": {
                "kind": "taskError",
                "task": "record"
              }
            },
            {
              "to": "classified",
              "gate": {
                "kind": "taskSuccess",
                "task": "record"
              }
            }
          ]
        },
        {
          "id": "needs_review",
          "label": "Needs review",
          "category": "active",
          "actions": [
            {
              "id": "retry",
              "label": "Retry classification",
              "variant": "primary",
              "transitionTo": "inbox"
            },
            {
              "id": "discard",
              "label": "Discard item",
              "variant": "destructive",
              "transitionTo": "discarded"
            }
          ]
        },
        {
          "id": "classified",
          "label": "Classified",
          "category": "terminal"
        },
        {
          "id": "discarded",
          "label": "Discarded",
          "category": "terminal"
        }
      ]
    }
  ],
  "actions": [
    {
      "id": "add_item",
      "label": "Add an item",
      "variant": "primary",
      "createInstance": {
        "workflowId": "items",
        "fields": [
          {
            "key": "description",
            "label": "Describe the item",
            "type": "string",
            "required": true
          }
        ]
      }
    }
  ],
  "edges": []
}
```

### Human review — when: an AI produces a proposal, verdict, or session that a human must approve or reject
human-review — a proposal a human must approve or reject:
  instanceState: [ { field: "title", type: "string" }, { field: "proposal", type: "string" } ]
  states:
    ready       (initial; action "start" primary → running)
    running     (active; ai-chat task with startOnUserInput: true, inputFromInstanceState: "title";
                 action "done" with completesRunningTask: true → reviewed)
    reviewed    (active; action "approve" primary → approved; action "reject" destructive → rejected)
    approved, rejected (terminals)
  the ai-chat transcript is the proposal; a patch op records output.content into the "proposal" field

### Pipeline / fan-out — when: one workflow's output creates many instances of another (a plan produces one item per planned unit)
pipeline-fan-out — one workflow's output produces many instances of another:
  workflow planning: initial → done (terminal); task "planWork" (ai-task, systemPrompt, completionOutput
    [ { field: "items", type: "object[]", description: "one entry per item to create" } ])
  workflow items: never created by a human; an edge creates one instance per planned unit:
    { fromWorkflow: "planning", fromStates: ["done"], toWorkflow: "items",
      fanOut: { task: "planWork", path: "output.items",
                fields: { title: { kind: "itemPath", path: "title" }, dependsOn: { kind: "itemPath", path: "dependencies" } } } }
  the target workflow's tasks then read the item fields (title, ...) seeded onto each instance

### Git-backed work — when: the work is code in a repository that must be committed, verified, and reviewed
git-backed work — work happens in a repository, with a worker and a reviewer:
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
  that patches it via patch_flow_config).

### Custom logic (referenced modules) — when: a gate needs logic beyond the structured predicates, or the flow needs a custom tool, operation, edge transform, or output extractor (a research loop, a websearch, a scraper)
custom-logic — reference a file for anything the structured vocabulary can't express:
  flow level: "tools": [ { "id": "websearch", "ref": "./tools/websearch.ts" } ],
              "operations": [ { "id": "score", "ref": "./ops/score.ts" } ],
              "dependencies": [ "axios" ]   // external packages the files may import
  a transition's gate: { "kind": "file", "ref": "./gates/approved.ts" }  // the file exports (ctx) => boolean
  a task: "tools": ["websearch"] (the custom tool id) and "operations": ["score", { "ref": "./ops/annotate.ts" }]
  an operation task may declare "extract": { "ref": "./extractors/parse.ts", "fields": ["verdict"] } — a
    referenced output extractor that patches the declared instance-state fields
  an edge: "transform": { "ref": "./edges/to-summary.ts", "fields": ["title", "body"] } — the target fields
  the referenced file implements the export the reference derives (keep the
  name and contract) and validate again — hand edits are authoritative. A file gate reads the runtime
  gate context (ctx.workflowInstanceState), so keep its transition in a state whose tasks are all
  complete (auto-transitions evaluate after each task).
  example lifecycle: searching (ai-chat task with the custom tool) → extracting (extractor op) → done,
  where the transition out of extracting is gated by the referenced gate file.

## Rules that make generated flows actually work

- Every `ai-task` and `ai-chat` declares a `systemPrompt` that names the job and the completion tool to call. A prompt-less agent produces prose instead of structured output, or the runner fails fast.
- When an ai-task must return data, declare `completionOutput` with exactly the fields the flow records — the only output an ai-task can carry is its completion-tool arguments.
- Record structured output with a sibling operation `patch` task that copies `output.<field>` into instanceState, and gate its `taskError` into a retry/needs-review state. A patch op fails when a sourced value is missing, so that state is mandatory, not optional.
- Every instance-state field shown by `instance`/`display` hints has a writer: a patch op, an edge field, a createInstance payload key, or an engine op. An instance that displays a field nothing writes is a broken card.
- Every created instance receives its seed data. Required createInstance fields reject empty values, and auto tasks seed their input from instanceState — so give each new instance the field its first task reads.
- A task's completion tool is offered automatically; list only infrastructure tools explicitly in `tools`.
- Every workflow with fallible tasks has a way out: a needs-review/error state with a retry action. An instance that can never leave a running state is a zombie.
- Design the whole lifecycle before writing the spec: which states exist, which are reachable from `initial`, which transitions fire under which gate, which terminals finish. A state nothing reaches, or that cannot leave, is a design flaw the check flags.
- Choose the pattern that matches the request (structured intake, human review, pipeline/fan-out, git-backed work) and copy its shape — do not improvise a new lifecycle when a tested one fits.
- Implement a referenced file by keeping the export name and contract the reference derives (gates/transforms/extracts/prompts export the camel-cased file base name; tools export <id>Tools; operations export <id>Operations) — the gate checks the exact name. A renamed or mis-typed export fails the lint with a specific finding.
- Hand edits to referenced files are authoritative — stub emission never overwrites an existing file. Write the implementation, then generate again to run the gate against it.
- Declare every external package a referenced file imports in the definition's `dependencies`. Imports are limited to engine primitives (workflow-engine/*), the flow's own files, `node:` builtins, and declared packages; anything else fails the gate with a readable finding.
- Keep a gate transition in a state whose tasks are all complete before the gate runs — auto-transitions evaluate after each task, so a gate sharing a state with an earlier task fires too early (a file gate reading a field an extractor writes must live in the state after the extractor).

## Vocabulary
## FlowDefinition vocabulary (the typed TS module you write — validated before it registers)

The flow definition is the single pure-data artifact: `export const flow: FlowDefinition = { ... }` in a TypeScript module, imported from `workflow-engine/workflow-types`. Workflows/states/tasks/actions/edges are data; gates are structured predicates; values are a small set of sources; every piece of custom logic (gates, tools, operations, transforms, extractors, prompts) is a referenced file (by ref path — the module imports nothing). No closures — a UI builder must serialize and round-trip this shape.

{
  id: "reviewFlow",              // non-empty slug (letters, digits, dashes)
  label: "Review Flow",
  description: "optional",
  configSchema: [ { key: "basePath", label: "Base path", type: "string", required: true } ],
  domainDir: ".review-flow",     // optional; defaults to .<definition-id>
  ui: { "view": "board", "kinds": [ { kind: "score", contract: { props: [...] } } ], "components": { "idea-card": "<Lit module source>" } },  // optional
  workflows: [ WORKFLOW, ... ],
  edges: [ EDGE, ... ],          // optional
  actions: [ FLOW_ACTION, ... ], // optional
  tools: [ { id: "websearch", ref: "./tools/websearch.ts", writes: ["result"] } ],  // optional; custom tools implemented as referenced files. "writes" declares the instance-state fields the tool executors patch (the read↔write invariant counts them as writers; the gate verifies the declared writes against the actual executor bodies)
  operations: [ { id: "score", ref: "./ops/score.ts", writes: ["score"] } ],       // optional; custom operations implemented as referenced files (same writer rule)
  dependencies: [ "axios" ],     // optional; external packages the referenced files may import (the import policy)
}

WORKFLOW: {
  id: "items",                   // valid identifier, unique per flow
  label: "Items",
  instanceState: [ { field: "verdict", type: "string" } ],   // declared fields replace the old type-alias anchors
  initial: "ready",              // one of the states
  terminalStates: ["done"],
  states: [ STATE, ... ],
  instance: { title: "title" },   // optional; dotted path into instanceState
  ui: { view: "board", columns: [ { id: "ready", label: "Ready", states: ["ready"] } ], instanceComponent: "idea-card" },  // optional; instanceComponent is a served component id (a key of the flow's ui.components)
  display: { fields: [ { path: "description", label: "Description", render: "markdown" } ] },  // optional; a field may add "render" or "derive" (see DERIVED DISPLAY below) — render is a builtin kind ("markdown"/"text"/"card"/"cards"/"json") as a bare string OR the object form { kind, props } binding prop names to dotted paths. Custom kinds declared in the flow's ui.kinds are also valid
  editFields: [ CONFIG FIELD, ... ]  // optional; the instance-state fields a user may edit in place via the "Edit details" form. Keys MUST be declared in instanceState. Each entry is a CONFIG FIELD (below)
}

CONFIG FIELD (configSchema entries and createInstance "fields"; validated — type must be one of the list):
  { key: "title", label: "Title", type: "string", required: true }   // string | boolean | number | textarea | date | datetime | string[]
  // textarea: multiline string. date: "YYYY-MM-DD". datetime: "YYYY-MM-DDTHH:mm".
  // string[]: multi-select; with "options" a closed set (each chosen value must be in it), without a free tag list.
  // "options": ["a", "b"] on a string field renders a single select; on string[] a multi-select.
  // "placeholder": "…" (input placeholder) and "defaultValue": … (pre-fill) are optional on any field.

DERIVED DISPLAY (optional "derive" on a display field; computes from the resolved path value — an array):
  { kind: "count" }                                             // array length ("N pending")
  { kind: "count", where: { field: "status", equals: "done" } }  // count of items where item.status === "done"
  { kind: "progress", where: { field: "status", equals: "done" } }  // "3 of 5 done" (bar); where is required
  { kind: "sum" }                                               // sum of an array of numbers
  { kind: "sum", field: "cost" }                               // sum of item.cost across the array
  // Example: { path: "items", label: "Done", derive: { kind: "progress", where: { field: "status", equals: "done" } } }
  // A derive that cannot evaluate (non-array, missing item field) falls back to the raw value.

ACROSS-INSTANCE DERIVES (same display field, but the path names an instance-state FIELD to aggregate over ALL instances of the workflow; requires a single-segment path):
  { kind: "countAcross" }                                       // total instances
  { kind: "countAcross", equals: "pending" }                    // instances whose state[path] === "pending" ("N pending")
  { kind: "progressAcross", equals: "review" }                  // "2 of 5 instances in review" (bar); equals is required
  // Example: { path: "status", label: "In review", derive: { kind: "countAcross", equals: "review" } }

STATE: {
  id: "running",
  label: "Running",
  description: "optional",  // a short state description (rendered in the UI)
  category: "initial" | "active" | "terminal" | "error",
  tasks: [ TASK, ... ],          // auto tasks that run on state entry
  autoTransitions: [ { to: "validating", gate: GATE }, ... ],
  actions: [ STATE_ACTION, ... ]
}

TASK: {
  id: "runAgent",                // valid identifier, unique per workflow
  label: "Run agent",
  role: "operation" | "ai-task" | "ai-chat",
  systemPrompt: "…",             // optional; ALWAYS set it on ai-task/ai-chat so the agent knows its job and that it must call the completion tool
  systemPromptRef: "./prompts/worker.ts",  // optional; a referenced system prompt — the file's named export (the camel-cased base name, e.g. "worker") is the prompt string. Mutually exclusive with "systemPrompt"
  operations: ["prepare_worktree", "score", { ref: "./ops/annotate.ts" }],  // engine op names, flow-level custom op ids, or inline references to a custom operation module
  operationInputs: { require: "committed" },   // verify_workspace: committed | changes | none
  tools: ["websearch", "read_file", "write_file"],  // infrastructure tool names + custom tool ids (the flow's "tools" list); the task's completion tool is added automatically
  completionTool: "complete_task",   // optional; only when the task does NOT declare "completionOutput" — then it must be a tool the task can call
  completionOutput: [ { field: "category", type: "string", description: "optional" } ],  // optional; ai-task or ai-chat. Declares the structured fields the task must return. The compiler generates a completion tool <workflowId>_<taskId>_complete with these fields (all required); the parsed arguments become the task output, so patch ops read output.<field> and gates compare output.<field>. An ai-chat surfaces them as output.completion.<field> next to the transcript (gates compare output.completion.<field>); an ai-task's output IS the arguments (output.<field>). Do NOT also set completionTool
  workspacePath: "@instance:worktreePath",  // literal dir or "@instance:<field>"
  inputFromInstanceState: "brief",   // dotted path into instanceState, seeded as the first message
  persist: { path: "reviews/{instanceId}-{attempt}.json" },
  patch: { verdict: { kind: "taskOutput", task: "runAgent", path: "output.verdict" } }  // OPERATION tasks only; writes instance state. A sourced value that resolves to undefined makes the op FAIL (taskError) — declare a retry/needs-review state for it
  extract: { ref: "./extractors/parse.ts", fields: ["verdict"] }  // OPERATION tasks only; a referenced output extractor. The generated op runs the extractor over the instance's task outputs and patches the declared fields into instance state
  render: { kind: "markdown", props: { content: "output" } },  // optional; how the task's completed output renders in the generic UI
}

STATE_ACTION: {
  id: "accept", label: "Accept",
  variant: "primary" | "secondary" | "destructive" | "default",
  transitionTo: "done",
  gate: GATE,                     // optional
  newAttempt: true,               // optional: engine bumps the attempt counter and discards the abandoned workspace
  completesRunningTask: true,     // optional: a human "Done" ends a running ai-chat session; the transcript is the output
  dependsOnState: "done",         // optional: engine blocks until instances reach this state
  confirmText: "Archive permanently?",  // optional: custom wording for the two-click confirm. Destructive variants confirm by default; declaring it adds a confirm step to any variant. Pair with "fields" for the "confirm + reason" pattern (collect a justification, then confirm)
  createInstance: { workflowId: "items", fields: [ { key: "title", label: "Title", type: "string", required: true } ] }  // optional
}

FLOW_ACTION: { id: "add_item", label: "Add item", variant: "primary",
  gate: GATE,   // optional; a visibility gate evaluated against the flow-level runtime context (e.g. a cross-instance file gate). Structured instance/task gates do not apply at the flow level
  createInstance: { workflowId: "items", fields: [ { key: "title", label: "Title", type: "string", required: true } ] },
  dispatchToAll: { workflowId: "items", actionId: "start" } }   // either createInstance or dispatchToAll

GATE (structured predicates — NO expression language, one of):
  { kind: "always" } | { kind: "never" }
  { kind: "hasRunningTask" } | { kind: "noRunningTask" }
  { kind: "taskSuccess", task: "runAgent" } | { kind: "taskError", task: "runAgent" }
  { kind: "taskOutputEquals", task: "runAgent", path: "output.completion.outcome", value: "approved" }   // path MUST start with "output"
  { kind: "instanceStateEquals", field: "verdict", value: "approved" }   // field declared in instanceState; scalar value must match its type
  { kind: "errorCountAtLeast", task: "validateCompletion", count: 3 }
  { kind: "file", ref: "./gates/approved.ts" }   // a gate implemented in a referenced file: the file exports (ctx) => boolean, and the engine calls it with the runtime gate context. Keep the transition in a state whose tasks are all complete — auto-transitions evaluate after each task
  { kind: "not", gate: GATE } | { kind: "and", gates: [ GATE, ... ] } | { kind: "or", gates: [ GATE, ... ] }

VALUE SOURCES (patch and edge field values):
  { kind: "literal", value: "approved" }   // string|number|boolean; must match the declared field type
  { kind: "taskOutput", task: "runAgent", path: "output.verdict" }   // dotted path into the task's outcome
  { kind: "instanceId" }                     // patch ops only, string fields only

EDGE: {
  fromWorkflow: "planning", fromStates: ["done"], toWorkflow: "items",
  fields: { title: { kind: "taskOutput", task: "planWork", path: "output" } },   // optional
  fanOut: { task: "planWork", path: "output.items", fields: { title: { kind: "itemPath", path: "title" }, dependsOn: { kind: "itemPath", path: "dependencies" } } }  // optional; one items instance per array item
  transform: { ref: "./edges/to-summary.ts", fields: ["title", "body"] }  // optional; the edge transform implemented in a referenced file (mutually exclusive with fields/fanOut). "fields" declares the target instance-state fields the transform produces
}

CONSTRAINTS (the validator rejects violations; fix them in the same definition):
- Every instance-state field that is READ (gates, instance/display hints, inputFromInstanceState, "@instance:" refs, dependsOnState) must have a WRITER: a patch op on an operation task, an edge field into that workflow, a createInstance payload key, or an engine op. Fields the engine provides (worktreePath, branchName, attempt) need no writer.
- Every write (patch key, edge field, createInstance key) must be declared in the target workflow's instanceState.
- Only engine operations and infrastructure tools from the capabilities list may be referenced.
- completionTool must be a tool the task can call — UNLESS the task declares "completionOutput", in which case the compiler generates the completion tool and completionTool must be omitted.
- gate taskOutputEquals paths start with "output" (the task's output); reads of a completionOutput task's output must reference a declared field through the role's wrapper (ai-task: output.<field>; ai-chat: output.completion.<field>).
- Workflow/state/task/field/action ids must be valid TS identifiers (no dashes, no spaces).
- A workflow with no instance state uses an empty instanceState array.
- A task may declare either "patch" (operation role) or nothing extra; patch writes on a task read a SIBLING task's output (the patch op runs as an operation task after that task completes).
- IMPORTS (the import policy): a referenced file may import engine primitives (workflow-engine/*), the flow's own files (relative paths inside the module set), node: builtins, and packages declared in the definition's "dependencies" list. Any other import fails the gate with a readable finding — declare the package in "dependencies" or remove the import.
- REFERENCED FILES ("tools"/"operations"/gate/transform/extract refs): implement the referenced file's named export — keep the name the reference derives (gates/transforms/extracts/prompts export the camel-cased file base name; tools export <id>Tools (a defineTool list); operations export <id>Operations (a defineOperations map)) — and validate again. Hand edits are authoritative — validation never overwrites a file. Gate files export (ctx) => boolean; edge transforms export a TransformContract; extractors export an OutputExtractor; prompt files export a string.

## Engine capabilities
HIVE WORKFLOW ENGINE — CAPABILITIES A FLOW GETS FOR FREE
A flow definition declares only its domain. Everything listed here is generic engine machinery a flow uses by name. Engine-provided state fields need no flow writer; engine-read state fields must be declared and written by the flow.

## Task roles (a task's `role`)
- ai-task
- ai-chat
- operation

## How a task ends (completion contracts)
- completionTool — The agent calls this tool to end the task; the parsed tool arguments become the task output. ai-task and ai-chat.
- completionSignal — The ai-chat agent ends the session by writing this marker as the last line of its response; the transcript becomes the task output. ai-chat only.
- completesRunningTask — A ManualAction flag: the human ends a running ai-chat session via a Done action; the transcript becomes the task output.
- completionOutput — An ai-task declares the structured fields it must return; the compiler generates a completion tool with those parameters, the agent calls it to end the task, and the parsed arguments become the task output (patch ops read output.<field>, gates compare output.<field>).
- newAttempt — A ManualAction flag: the action starts a fresh attempt — the engine bumps the instance's `attempt` counter and discards the abandoned workspace in `worktreePath`. Engine-owned bookkeeping; a flow just declares the flag.

## Declarative output persistence (task `persist: { path }`)
- path templates: {instanceId}, {attempt}
- format inference: string output becomes a text file; object/array becomes JSON

## Error bookkeeping (gates read `ctx.taskErrorCounts`)
- taskErrorCounts — Consecutive per-task error counter exposed to gates as ctx.taskErrorCounts; increments on a task's error, resets on its success. e.g. 'escalate after 3 failed validations'.

## Cross-instance capabilities (gates and ops)
- workflowInstancesInState(stateId?) — query instances by state from gates and ops
- maxWorkflowInstancesInTarget — engine-enforced concurrency limit on a ManualAction
- dependsOnState — engine backstop: resolves workflowInstanceState.dependsOn (ids or titles) against instances already in the target state

## Instance-state access in tools and ops
- Tools (defineTool executors) and operations (defineOperations) receive a live instance-state getter (ctx.workflowInstanceState()) and patch (ctx.patchWorkflowInstanceState(...)). The getter sees the current state — including patches from earlier turns, the flow, or the instance-state API — so a capability like an authoring session's save_definition can read the generated source and the id of a prior save instead of requiring every input as a parameter. Tools mirror the operation context; the generic engine never reads or writes files.

## Engine-provided state fields (no flow writer needed)
- worktreePath — written by prepare_worktree (and flows' own workspace ops); read by verify_workspace, merge_branch, and @instance: workspacePath refs
- branchName — written by prepare_worktree; read by verify_workspace and merge_branch
- attempt — written by the newAttempt action flag; read by prepare_worktree, merge_branch, and {attempt} persist paths (unwritten counters default to 1)

## Engine-read state fields (must be declared and written by the flow)
- dependsOn — read by the engine's dependsOnState backstop; written by the flow (edge transforms, createInstance payloads, normalize ops)

## Infrastructure tools (offered to every flow's agents; a task's `tools` lists the names)
- read_file — Read the contents of a file relative to the workspace root.
- list_directory — List files and folders in a directory relative to the workspace root.
- search_code — Search for a pattern in the codebase using ripgrep. Returns matching file paths and line content.
- write_file — Write content to a file, creating parent directories as needed. The path is relative to the workspace root.
- run_command — Execute one finite program in the worktree without a shell. Commands time out after 30 seconds. Do not launch graphical applications, development servers, or other interactive/long-running processes. Pass only the executable name in 'command' and every argument as a separate item in 'args'. Compound shell expressions, pipes, redirection, and direct Git mutations are not supported.
- git_status — Show the current git working-tree status.
- git_diff — Show the complete working tree or committed diff. When baseCommit is provided, shows diff between baseCommit and HEAD.
- git_log — Show commits on the current branch. When baseCommit is provided, shows commits since that base.
- git_show — Read a committed file at a specific revision.
- commit_work — Create a meaningful implementation commit. Declare exactly which relative worktree paths belong in the commit. Repository Git hooks run normally.
- create_instance — Create a new workflow instance in this flow (e.g. graduate fog into a fresh decision ticket). The instance starts in its workflow's initial state; the supplied object becomes its domain state. Only available where the task declares this tool.
- complete_task — Complete the current task with a declared outcome. This must be the only tool call in the response. The arguments become the task output.

## Engine operations (resolved by name; a task's `operations` lists the names)
- prepare_worktree — Prepare an isolated workspace: a git worktree on a feature branch when a repo is bound, a plain sandbox otherwise. Writes worktreePath/branchName; reads attempt. reads: attempt; writes: worktreePath, branchName
- verify_workspace — Verify the isolated workspace accumulated the required work (operationInputs.require: committed | changes | none). Reads worktreePath/branchName. reads: worktreePath, branchName; writes: none
- merge_branch — No-ff merge a workflow instance's feature branch into the integration branch; discards the worktree and deletes the branch. Reads attempt/worktreePath. reads: attempt, worktreePath; writes: none
- patch_flow_config — Write fields into FlowConfig from within a task; @flow:<field> copies a current config value. reads: none; writes: none
- commit_flow_state — Commit the declared domainDir to the integration branch. Explicit checkpoints only. reads: none; writes: none
- validate_repo — Validate a bound repository (exists, is git, has a HEAD). reads: none; writes: none

## Render kinds (a task's `render` hint)
- markdown, text, card, cards, json
