## FlowDefinition vocabulary (the typed TS module you write — validated before it registers)

The flow definition is the single pure-data artifact: `export const flow: FlowDefinition = { ... }` in a TypeScript module, imported from `workflow-engine/workflow-types`. Workflows/states/tasks/actions/edges are data; gates are structured predicates; values are a small set of sources; every piece of custom logic (gates, tools, operations, transforms, extractors, prompts) is a referenced file (by ref path — the module imports nothing). No closures — a UI builder must serialize and round-trip this shape.

{
  id: "reviewFlow",              // non-empty slug (letters, digits, dashes)
  label: "Review Flow",
  description: "optional",
  configSchema: [ { key: "basePath", label: "Base path", type: "string", required: true } ],
  flowState: [ { field: "taxonomy", type: "object" } ],   // optional (E2); the flow's declared cross-entity state — field + type like instanceState (object/object[] for structured values). FlowState writes (patchFlowState ops and toFlowState edge transforms) are validated against these fields; cross-entity data lives here, never duplicated on instances
  domainDir: ".review-flow",     // optional; defaults to .<definition-id>
  ui: { "view": "board", "kinds": [ { kind: "score", contract: { props: [...] } } ], "components": { "ticket-card": { ref: "./ui/ticket-card.ts" } }, "flowComponent": "flow-page", "persistedOutputs": ["map.md"], "persistedOutputDirs": ["decisions"] },  // optional; components are served module FILES (refs — the primary form, same lifecycle as tools/ops: linted, typechecked, gate-checked) or inline source strings (legacy). Each default-exports a factory receiving the app's lit runtime; type-only imports from lit/workflow-engine/workflow-types are allowed, value imports are not. flowComponent names a served component id rendering the WHOLE flow-instance page body (the flow owns its hero, actions, and sections; the shell keeps only the breadcrumb + a manage/delete affordance — never exposed to a served module). persistedOutputs / persistedOutputDirs declare the persisted domain files the UI may read (fixed paths relative to domainDir, and directory names whose files the UI lists + reads) — the server ships their contents in the flow snapshot
  workflows: [ WORKFLOW, ... ],
  edges: [ EDGE, ... ],          // optional
  actions: [ FLOW_ACTION, ... ], // optional
  tools: [ { id: "websearch", ref: "./tools/websearch.ts", writes: ["result"] } ],  // optional; custom tools implemented as referenced files. "writes" declares the instance-state fields the tool executors patch (the read↔write invariant counts them as writers; the gate verifies the declared writes against the actual executor bodies)
  operations: [ { id: "score", ref: "./ops/score.ts", writes: ["score"], writesAcross: [ { workflow: "ideas", fields: ["category"] } ] } ],       // optional; custom operations implemented as referenced files (same writer rule). "writesAcross" (E1) declares the instance-state fields the op patches on SIBLING instances of another workflow via ctx.patchInstanceState(instanceId, patch) — the validator checks the fields against the target workflow's instanceState, and the module-set gate verifies the actual op body against the declaration
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
  ui: { view: "board", columns: [ { id: "ready", label: "Ready", states: ["ready"] } ], groupByField: "category", instanceComponent: "idea-card", workflowComponent: "frontier-board" },  // optional; instanceComponent is a served component id (a key of the flow's ui.components) rendering each workflow instance; workflowComponent is a served component id rendering the workflow's ENTIRE workflow-instances section (replacing the generic grouped board/list content — the section header and page furniture stay standard; an unknown id falls back to the grouped board). groupByField (E3) partitions the board by the distinct values of a declared instance-state field — one column per value plus an "Uncategorized" column for empties. A GENERIC partition: the engine never reads or interprets the values (no labels, ordering, or semantics — column ids/labels are the raw values; the domain maps values to labels via display hints). Mutually exclusive with columns
  display: { fields: [ { path: "description", label: "Description", render: "markdown" } ] },  // optional; a field may add "render" or "derive" (see DERIVED DISPLAY below) — render is a builtin kind ("markdown"/"text"/"card"/"cards"/"json") as a bare string OR the object form { kind, props } binding prop names to dotted paths. Custom kinds declared in the flow's ui.kinds are also valid
  editFields: [ CONFIG FIELD, ... ]  // optional; the instance-state fields a user may edit in place via the "Edit details" form. Keys MUST be declared in instanceState. Each entry is a CONFIG FIELD (below)
}

CONFIG FIELD (configSchema entries and createInstance "fields"; validated — type must be one of the list):
  { key: "title", label: "Title", type: "string", required: true }   // string | boolean | number | textarea | date | datetime | string[]
  // textarea: multiline string. date: "YYYY-MM-DD". datetime: "YYYY-MM-DDTHH:mm".
  // string[]: multi-select; with "options" a closed set (each chosen value must be in it), without a free tag list.
  // "options": ["a", "b"] on a string field renders a single select; on string[] a multi-select.
  // "optionsFrom": { flowState: "taxonomy.categories" } (E4): dynamic select options sourced from flowState at runtime (e.g. the AI-proposed category taxonomy drives the human edit UI). The path's first segment must be a declared flowState field; the server resolves it to options when serializing instance entries; when flowState lacks the value the field falls back to free text. Mutually exclusive with static "options".
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
  deletesInstance: true,          // optional (E5): destructive-only, no transitionTo — the action removes the instance from the flow when it fires (controller dropped, persisted state deleted, instance_removed emitted; the board drops it). Title-based references to the removed instance go stale gracefully
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
  { kind: "file", ref: "./gates/approved.ts" }   // a gate implemented in a referenced file: the file exports (ctx) => boolean (type it `GateContract<IdeaState, FlowState>` to bind the flow's own state types — instance and flowState fields become typed, no casts; keep fields optional, since a field is genuinely undefined until its writer runs, and guard with ??/?. — runtime truth, not type noise). The engine evaluates it with the runtime gate context; a gate that throws evaluates as FALSE (fail-safe: it says "no", it never errors the completing task). Keep the transition in a state whose tasks are all complete — auto-transitions evaluate after each task
  { kind: "not", gate: GATE } | { kind: "and", gates: [ GATE, ... ] } | { kind: "or", gates: [ GATE, ... ] }

VALUE SOURCES (patch and edge field values):
  { kind: "literal", value: "approved" }   // string|number|boolean; must match the declared field type
  { kind: "taskOutput", task: "runAgent", path: "output.verdict" }   // dotted path into the task's outcome
  { kind: "instanceId" }                     // patch ops only, string fields only

OPERATION CONTEXT (what a referenced operation receives via ctx — E1/E6/E2):
  ctx.workflowInstanceState() / ctx.patchWorkflowInstanceState(patch)   // own instance state
  ctx.flowState() / ctx.patchFlowState(patch)                          // flow-level state (E2): read + write the flow's declared cross-entity state (e.g. the taxonomy). The write mirrors patchFlowConfig — persists + emits flow_state_changed. Declare the fields in the definition's flowState; the module-set gate rejects an undeclared patchFlowState key
  ctx.workflowInstancesInState()                                      // every instance of the flow; each carries id + workflowId + currentState + workflowInstanceState
  ctx.workflowInstancesInState("ideas")                              // filter by workflow (E6): every ideas instance
  ctx.workflowInstancesInState(undefined, "done")                    // filter by state: every done instance of any workflow
  ctx.workflowInstancesInState("ideas", "done")                      // both filters
  ctx.patchInstanceState(instanceId, patch)                           // cross-instance write (E1): patches a SIBLING instance's declared state, same-flow only. Returns false for an unknown id (a NOOP the op handles); throws on a field the target workflow's instanceState does not declare. The write persists and emits like an own-instance patch. Every sibling write must be declared in the operation's writesAcross — the module-set gate rejects undeclared ones.
  ctx.flowConfig() / ctx.patchFlowConfig(patch) / ctx.taskOutputs()   // flow config and completed sibling task outputs

EDGE: {
  fromWorkflow: "planning", fromStates: ["done"], toWorkflow: "items",
  fields: { title: { kind: "taskOutput", task: "planWork", path: "output" } },   // optional
  fanOut: { task: "planWork", path: "output.items", fields: { title: { kind: "itemPath", path: "title" }, dependsOn: { kind: "itemPath", path: "dependencies" } } }  // optional; one items instance per array item
  transform: { ref: "./edges/to-summary.ts", fields: ["title", "body"] }  // optional; the edge transform implemented in a referenced file (mutually exclusive with fields/fanOut). "fields" declares the target instance-state fields the transform produces
  toFlowState: true,   // optional (E2): the transform output updates flowState instead of creating instances — no toWorkflow. The transform's declared fields must be declared flowState fields. Edges (incl. toFlowState) fire only on terminal states; write flowState mid-lifecycle with a patchFlowState op instead
}

CONSTRAINTS (the validator rejects violations; fix them in the same definition):
- Every instance-state field that is READ (gates, instance/display hints, inputFromInstanceState, "@instance:" refs, dependsOnState) must have a WRITER: a patch op on an operation task, an edge field into that workflow, a createInstance payload key, an engine op, or a cross-instance write declared in an op's writesAcross. Fields the engine provides (worktreePath, branchName, attempt) need no writer.
- Every write (patch key, edge field, createInstance key, writesAcross field) must be declared in the target workflow's instanceState.
- Every state action declares transitionTo or deletesInstance (a deletesInstance action is destructive-only and mutually exclusive with transitionTo).
- Only engine operations and infrastructure tools from the capabilities list may be referenced.
- WEB ACCESS (`web_fetch`): the engine ships `web_fetch` (a generic infra tool) — fetch an HTTP(S) URL and get it back as compact markdown (chrome stripped, whitespace collapsed, truncated; ads/menus in `nav`/`header`/`footer`/`aside` are dropped). Only same-origin redirects are followed; SSRF/private-network blocking is deliberately NOT implemented (do not grant `web_fetch` where it can reach sensitive internal targets). To supply your own fetch, declare a domain tool with the same name (`tools: [{ id: "web_fetch", ref: "./tools/web-fetch.ts" }]`) — a domain tool overrides the built-in executor by name. A task gets the tool only when its `tools` list names it.
- EXTRA READ ROOTS (`extraReadRoots`): declare directories the file tools may read beyond the workspace — absolute paths or paths relative to the base path (`configSchema` field `extraReadRoots: string[]`; wayfinder calls it "Reference paths"). The file tools resolve against the workspace then each extra root. A human can also grant a path mid-session by typing it as its own chat message (an absolute path, `~/`-, `./`- or `../`-relative, or a bare directory reference like `effect/`) — the session grants read access to it immediately; prose grants nothing.
- CREATE IN A STATE (`create_instance` stateId): the tool accepts an optional `stateId` to start a new instance directly in a declared state (defaults to the workflow's initial state; validated against the workflow's states). Use it when a fresh instance belongs in an active state; if it must pass through an entry state's processing (normalization, seeding), keep the default initial-state entry instead.
- completionTool must be a tool the task can call — UNLESS the task declares "completionOutput", in which case the compiler generates the completion tool and completionTool must be omitted.
- gate taskOutputEquals paths start with "output" (the task's output); reads of a completionOutput task's output must reference a declared field through the role's wrapper (ai-task: output.<field>; ai-chat: output.completion.<field>).
- Workflow/state/task/field/action ids must be valid TS identifiers (no dashes, no spaces).
- A workflow with no instance state uses an empty instanceState array.
- A task may declare either "patch" (operation role) or nothing extra; patch writes on a task read a SIBLING task's output (the patch op runs as an operation task after that task completes).
- IMPORTS (the import policy): a referenced file may import engine primitives (workflow-engine/*), the flow's own files (relative paths inside the module set), node: builtins, and packages declared in the definition's "dependencies" list. Any other import fails the gate with a readable finding — declare the package in "dependencies" or remove the import.
- SERVED COMPONENT MODULES (ui.components): declare them as refs — `{ ref: "./ui/ticket-card.ts" }` — the file is a module-set member with the same gate lifecycle as a tool/operation (linted, typechecked, import-policied). The module default-exports a factory receiving the app's lit runtime (`{ LitElement, html, css, nothing }`) and returning `{ components?, kinds? }`; it must stay a standalone blob — type-only imports from lit/workflow-engine/workflow-types (or the flow's own files) only, NEVER a value import. Type the factory with the contract types (`FlowComponentDeps`, `FlowComponentRegistrations`, `InstanceComponentProps`, `WorkflowViewProps`, `FlowViewProps` from workflow-engine/workflow-types). Custom render kinds registered via `kinds` may be kebab-case ("findings-report") — they are registry keys, not identifiers. A component id declared as a workflow's `workflowComponent` receives `WorkflowViewProps` (the workflow def, its entries, customKinds, the cross-workflow `workflowCounts` — per workflow: total + counts by current state — and onAction/onSendMessage/onSelect) and renders the workflow-instances section; compose the canonical board under custom chrome with the globally-registered `<workflow-board-content>` element. A component id declared as the flow's `flowComponent` receives `FlowViewProps` (the trimmed flow projection { id, label, status, config }, every workflow def + entry, workflowCounts, availableFlowActions, the declared persistedOutputs/persistedOutputDirs, and onAction/onSendMessage/onPatchState/onSelect/onFlowAction/onCreate) and renders the WHOLE page body. Served modules compose ONLY default elements by tag (`<workflow-board-content>`, `<markdown-view>`, `<chat-session>`): served modules are registered under generated tags, so one served module cannot reference another served module's component id as a tag — put per-workflow custom cards in `instanceComponent` (registry-resolved) and compose the canonical board with `<workflow-board-content>`.
- PERSISTED OUTPUTS (ui.persistedOutputs / ui.persistedOutputDirs): declare the persisted domain files the UI may read — fixed paths relative to domainDir (`map.md`, `spec.md`, `build-plan.md`) and directory names whose files the UI lists + reads (`decisions/`). The server resolves each through the engine's persisted-output seam (confined to basePath/<domainDir>) and ships the contents in the flow snapshot (`ui.persistedOutputs: Record<path, string>`, `ui.persistedOutputDirs: Record<dir, Record<fileName, string>>`); served components receive them as PROPS (import-free). A declared path that escapes the domain root degrades to empty, never a snapshot error.
- CREATION INPUTS SEED THE FIRST INSTANCE (the seed rule): the flow config an instance is created with is copied into the first workflow instance's declared instance-state fields, and an input-driven initial AI task (inputFromInstanceState) whose input the creation config provides starts immediately — the instance is NOT skipped. So a flow whose first workflow declares e.g. `destination` gets it on the map and in the opening session; a first-workflow AI session with `startOnUserInput: true` + `inputFromInstanceState` opens with that value as its first user message.
- REFERENCED FILES ("tools"/"operations"/gate/transform/extract refs): implement the referenced file's named export — keep the name the reference derives (gates/transforms/extracts/prompts export the camel-cased file base name; tools export <id>Tools (a defineTool list); operations export <id>Operations (a defineOperations map)) — and validate again. Hand edits are authoritative — validation never overwrites a file. Gate files export (ctx) => boolean; edge transforms export a TransformContract; extractors export an OutputExtractor; prompt files export a string.
