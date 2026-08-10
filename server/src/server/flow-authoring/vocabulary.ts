/** The FlowSpec vocabulary — the closed, validated JSON shape an AI emits.
 * This is the reference rung of the flow-authoring knowledge: what the model
 * can say, not how to design. The decisions/patterns/rules modules sit above
 * it in the prompt; the loop's validation enforces it. */

export const FLOW_SPEC_SHAPE = `## FlowSpec vocabulary (the JSON you emit — validated before rendering)

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
  "display": { "fields": [ { "path": "description", "label": "Description" } ] },                          // optional; a field may add "render" (markdown/text/card/cards/json) or "derive" (see DERIVED DISPLAY below)
  "editFields": [ CONFIG FIELD, ... ]  // optional; the instance-state fields a user may edit in place via the "Edit details" form. Keys MUST be declared in instanceState. Each entry is a CONFIG FIELD (below).
}

CONFIG FIELD (configSchema entries and createInstance "fields"; validated before render — type must be one of the list):
  { "key": "title", "label": "Title", "type": "string", "required": true }   // string | boolean | number | textarea | date | datetime | string[]
  // textarea: multiline string. date: "YYYY-MM-DD". datetime: "YYYY-MM-DDTHH:mm".
  // string[]: multi-select; with "options" a closed set (each chosen value must be in it), without a free tag list.
  // "options": ["a", "b"] on a string field renders a single select; on string[] a multi-select.
  // "placeholder": "…" (input placeholder) and "defaultValue": … (pre-fill) are optional on any field.

DERIVED DISPLAY (optional "derive" on a display field; computes from the resolved path value — an array):
  { "kind": "count" }                                             // array length ("N pending")
  { "kind": "count", "where": { "field": "status", "equals": "done" } }  // count of items where item.status === "done"
  { "kind": "progress", "where": { "field": "status", "equals": "done" } }  // "3 of 5 done" (bar); where is required
  { "kind": "sum" }                                               // sum of an array of numbers
  { "kind": "sum", "field": "cost" }                             // sum of item.cost across the array
  // Example: { "path": "items", "label": "Done", "derive": { "kind": "progress", "where": { "field": "status", "equals": "done" } } }
  // A derive that cannot evaluate (non-array, missing item field) falls back to the raw value.

ACROSS-INSTANCE DERIVES (same display field, but the path names an instance-state FIELD to aggregate over ALL instances of the workflow; requires a single-segment path):
  { "kind": "countAcross" }                                       // total instances
  { "kind": "countAcross", "equals": "pending" }                  // instances whose state[path] === "pending" ("N pending")
  { "kind": "progressAcross", "equals": "review" }                // "2 of 5 instances in review" (bar); equals is required
  // Example: { "path": "status", "label": "In review", "derive": { "kind": "countAcross", "equals": "review" } }

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
  "confirmText": "Archive permanently?",  // optional: custom wording for the two-click confirm. Destructive variants confirm by default; declaring it adds a confirm step to any variant. Pair with "fields" for the "confirm + reason" pattern (collect a justification, then confirm).
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
- A task may declare either "patch" (operation role) or nothing extra; patch writes on a task read a SIBLING task's output (the patch op runs as an operation task after that task completes).`;
