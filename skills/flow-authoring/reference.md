# Flow Authoring — the Hive skill

The knowledge for designing and generating Hive flow definitions. This document is rendered from the same modules the in-product generation prompt uses (`server/src/server/flow-authoring/`), so it cannot drift from what the generator teaches the model.

## How to design a flow (decisions, in order)

1. **Entities.** One workflow per entity the flow tracks — an item, a request, a record, a session, an order — whatever the domain's unit of work is. Each workflow is a lifecycle: an initial state where instances are born, active states where work happens, terminal states where instances finish. Per-instance data lives in `instanceState`; cross-entity data lives in flow-level state (`flowState`), never duplicated on instances.

2. **Who does the work.** A state's tasks run on entry:
   - `operation` — deterministic work: an engine op (`prepare_worktree`, `verify_workspace`, `merge_branch`, `patch_flow_config`, `commit_flow_state`, `validate_repo`) or a patch op that records another task's output into instanceState.
   - `ai-task` — one-shot AI work that RETURNS DATA. Give it a `systemPrompt` naming the job and the completion tool, seed it with `inputFromInstanceState`, and declare `completionOutput` with exactly the fields it must return. Record those fields with a sibling operation `patch` task.
   - `ai-chat` — a multi-turn AI session. Use `startOnUserInput: true` when a human talks with the agent (HITL); the session ends when the human clicks an action with `completesRunningTask: true`, or the agent calls its completion tool.

3. **How an ai-task returns data.**
   - `completionOutput: [{ field, type }]` — the agent must return exactly these fields; the renderer generates the completion tool; patches and gates read `output.<field>`. Use this whenever the flow must RECORD structured data (a category, a verdict, tags, a spec).
   - `completionTool: "complete_task"` — the agent returns `{ outcome, summary, rationale }`. Use only for "did you do the work" outcomes, never for domain data.
   - Neither — the transcript becomes the output. Use only for advice or prose that nobody records.

4. **How a human drives the flow.** `ManualAction` buttons on states; flow-level actions for creating instances (`createInstance`) or bulk dispatch (`dispatchToAll`). Variants: `primary` = the call to action, `destructive` = irreversible (discard/delete), `secondary`/default = neutral. Every instance needs a way to be created and a way to finish.

5. **How work flows between workflows.** Edges: when an instance of one workflow reaches a state you list, its task output transforms into a new instance of another workflow (`fields`) — or one instance per array item (`fanOut`). Use edges to build pipelines, never to duplicate data.

6. **Error handling — every flow needs an escape hatch.** Any ai-task or operation can fail. For every state with fallible tasks, add a needs-review/error state, gate `taskError` autoTransitions into it, and give it a retry action (transition back to the work state) and a discard action (transition to a terminal). The engine fails fast on ai-tasks with no system prompt and no input, so a state with no escape hatch becomes a stuck instance.

7. **UI.** Every workflow declares `instance: { title }` (and optionally `subtitle`) plus `display: { fields }` so instances show meaningful content — declare display fields ONLY for fields something actually writes. Choose `ui.view`: `board` (default, one column per state or per declared column), `list`, `document`, `chat`.

8. **Documents.** When a task produces a document (a specification, a review package, a report), declare `persist: { path }` so the output lands in the flow's domain root; the path supports `{instanceId}` and `{attempt}` substitution.

9. **Pick the pattern, don't improvise.** Match the request to one of the patterns below and copy its shape: structured intake, human review, pipeline/fan-out, or git-backed work. The patterns are the tested shapes; the vocabulary is their language. Use whatever nouns fit the request's domain — the patterns and vocabulary are domain-agnostic.

## Patterns (pick the one that fits, then copy its shape)

### Structured intake — when: users add items that an AI classifies, enriches, or triages into recorded fields, then items finish or need a human retry
A complete valid spec for this pattern:
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
      "initialState": "inbox",
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

## Vocabulary
## FlowSpec vocabulary (the JSON you emit — validated before rendering)

{
  "id": "reviewFlow",              // valid TS identifier (camelCase)
  "label": "Review Flow",
  "description": "optional",
  "configSchema": [ { "key": "basePath", "label": "Base path", "type": "string", "required": true } ],
  "workflows": [ WORKFLOW, ... ],
  "edges": [ EDGE, ... ],          // optional
  "actions": [ FLOW_ACTION, ... ]  // optional
}

WORKFLOW: {
  "id": "items",                   // valid identifier, unique per flow
  "label": "Items",
  "instanceState": [ { "field": "verdict", "type": "string" } ],
  "initialState": "ready",         // one of the states
  "terminalStates": ["done"],
  "states": [ STATE, ... ],
  "instance": { "title": "title" },   // optional; dotted path into instanceState
  "ui": { "view": "board", "columns": [ { "id": "ready", "label": "Ready", "states": ["ready"] } ] },  // optional
  "display": { "fields": [ { "path": "description", "label": "Description" } ] }                          // optional
}

STATE: {
  "id": "running",
  "label": "Running",
  "category": "initial" | "active" | "terminal" | "error",
  "tasks": [ TASK, ... ],          // auto tasks that run on state entry
  "autoTransitions": [ { "to": "validating", "gate": GATE }, ... ],
  "actions": [ STATE_ACTION, ... ]
}

TASK: {
  "id": "runAgent",                // valid identifier, unique per workflow
  "label": "Run agent",
  "role": "operation" | "ai-task" | "ai-chat",
  "systemPrompt": "…",             // optional; ALWAYS set it on ai-task/ai-chat so the agent knows its job and that it must call the completion tool
  "operations": ["prepare_worktree"],  // ENGINE op names only (capabilities list)
  "operationInputs": { "require": "committed" },   // verify_workspace: committed | changes | none
  "tools": ["read_file", "write_file", "run_command", "git_status", "git_diff", "git_log", "commit_work", "search_code", "list_directory", "git_show"],  // infrastructure tool names only; the task's completion tool is added automatically
  "completionTool": "complete_task",   // optional; only when the task does NOT declare "completionOutput" — then it must be "complete_task"
  "completionOutput": [ { "field": "category", "type": "string", "description": "optional" } ],  // optional; ai-task ONLY. Declares the structured fields the task must return. The renderer generates a completion tool <workflowId>_<taskId>_complete with these fields (all required); the parsed arguments become the task output, so patch ops read output.<field> and gates compare output.<field>. Do NOT also set completionTool.
  "workspacePath": "@instance:worktreePath",  // literal dir or "@instance:<field>"
  "inputFromInstanceState": "brief",   // dotted path into instanceState, seeded as the first message
  "persist": { "path": "reviews/{instanceId}-{attempt}.json" },
  "patch": { "verdict": { "kind": "taskOutput", "task": "runAgent", "path": "output.verdict" } }  // OPERATION tasks only; writes instance state. A sourced value that resolves to undefined makes the op FAIL (taskError) — declare a retry/needs-review state for it.
}

STATE_ACTION: {
  "id": "accept", "label": "Accept",
  "variant": "primary" | "secondary" | "destructive" | "default",
  "transitionTo": "done",
  "gate": GATE,                     // optional
  "newAttempt": true,               // optional: engine bumps the attempt counter and discards the abandoned workspace
  "completesRunningTask": true,     // optional: a human "Done" ends a running ai-chat session; the transcript is the output
  "dependsOnState": "done",         // optional: engine blocks until instances reach this state
  "createInstance": { "workflowId": "items", "fields": [ { "key": "title", "label": "Title", "type": "string", "required": true } ] }  // optional
}

FLOW_ACTION: { "id": "add_item", "label": "Add item", "variant": "primary",
  "createInstance": { "workflowId": "items", "fields": [ { "key": "title", "label": "Title", "type": "string", "required": true } ] },
  "dispatchToAll": { "workflowId": "items", "actionId": "start" } }   // either createInstance or dispatchToAll

GATE (structured predicates — NO expression language, one of):
  { "kind": "always" } | { "kind": "never" }
  { "kind": "hasRunningTask" } | { "kind": "noRunningTask" }
  { "kind": "taskSuccess", "task": "runAgent" } | { "kind": "taskError", "task": "runAgent" }
  { "kind": "taskOutputEquals", "task": "runAgent", "path": "output.completion.outcome", "value": "approved" }   // path MUST start with "output"
  { "kind": "instanceStateEquals", "field": "verdict", "value": "approved" }   // field declared in instanceState; scalar value must match its type
  { "kind": "errorCountAtLeast", "task": "validateCompletion", "count": 3 }
  { "kind": "not", "gate": GATE } | { "kind": "and", "gates": [ GATE, ... ] } | { "kind": "or", "gates": [ GATE, ... ] }

VALUE SOURCES (patch and edge field values):
  { "kind": "literal", "value": "approved" }   // string|number|boolean; must match the declared field type
  { "kind": "taskOutput", "task": "runAgent", "path": "output.verdict" }   // dotted path into the task's outcome
  { "kind": "instanceId" }                     // patch ops only, string fields only

EDGE: {
  "fromWorkflow": "planning", "fromStates": ["done"], "toWorkflow": "items",
  "fields": { "title": { "kind": "taskOutput", "task": "planWork", "path": "output" } },   // optional
  "fanOut": { "task": "planWork", "path": "output.items", "fields": { "title": { "kind": "itemPath", "path": "title" }, "dependsOn": { "kind": "itemPath", "path": "dependencies" } } }  // optional; one items instance per array item
}

CONSTRAINTS (the validator rejects violations; fix them in the same spec):
- Every instance-state field that is READ (gates, instance/display hints, inputFromInstanceState, "@instance:" refs, dependsOnState) must have a WRITER: a patch op on an operation task, an edge field into that workflow, a createInstance payload key, or an engine op. Fields the engine provides (worktreePath, branchName, attempt) need no writer.
- Every write (patch key, edge field, createInstance key) must be declared in the target workflow's instanceState.
- Only engine operations and infrastructure tools from the capabilities list may be referenced.
- completionTool must be "complete_task" — UNLESS the task declares "completionOutput", in which case the renderer generates the completion tool and completionTool must be omitted.
- gate taskOutputEquals paths start with "output" (the task's output); reads of a completionOutput task's output must reference a declared field.
- Workflow/state/task/field/action ids must be valid TS identifiers (no dashes, no spaces).
- A workflow with no instance state uses an empty instanceState array.
- A task may declare either "patch" (operation role) or nothing extra; patch writes on a task read a SIBLING task's output (the patch op runs as an operation task after that task completes).

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
- completionOutput — An ai-task declares the structured fields it must return; the renderer generates a completion tool with those parameters, the agent calls it to end the task, and the parsed arguments become the task output (patch ops read output.<field>, gates compare output.<field>).
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
