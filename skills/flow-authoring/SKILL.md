---
name: flow-authoring
description: Design and generate Hive flow definitions (presets and AI-generated flows) with a tested lifecycle. Use when the user wants to create a flow, asks to "generate a flow", design a workflow, add an item/record lifecycle, fix a generated flow that doesn't work, or build on the Hive workflow engine's flow-authoring vocabulary (FlowBlueprint, completionOutput, edges, states, gates, blueprint-referenced modules).
---

# Flow Authoring — Hive

Design flows for the Hive workflow engine the way the engine actually works: pick a tested lifecycle, declare the domain, let the engine provide everything else. The engine is declarative — a flow is data (workflows, states, tasks, edges, actions), and the schema-consistency check + typechecker are the gate that keeps it honest.

The authoritative knowledge — decisions, patterns, rules, vocabulary, capabilities — lives in `server/src/server/flow-authoring/` and is rendered into `skills/flow-authoring/reference.md` (regenerate with `pnpm --filter server export:flow-authoring` after changing the modules). **Read reference.md before authoring.** The reference presets `presets/queen-bee/` and `presets/wayfinder/` are the canonical real flows.

## Process

### 1. Design the flow before writing anything

Produce, in order:

- **Entities** — one workflow per entity (items, requests, records, sessions — whatever the domain's unit of work is). Each is a lifecycle: initial state (birth), active states (work), terminal states (finish).
- **Where AI is used** — which states run an `ai-task` (one-shot, returns data), an `ai-chat` (multi-turn, HITL), or only operations.
- **Structured data** — for every ai-task that must return data, the exact `completionOutput` fields.
- **Human drive** — the `ManualAction` buttons and flow-level actions; how instances get created.
- **Connections** — which edges/fan-out move work between workflows.
- **The escape hatch** — every state with fallible tasks needs a needs-review/error state with a retry action.

**Completion criterion:** every workflow has a way in (creation path), a way through (each active state can leave), and a way out (a terminal or an error state with a retry). If any state can't be reached or can't leave, redesign before writing.

### 2. Pick the pattern, don't improvise

Match the request to a pattern in `reference.md` (## Patterns) and copy its shape:

- **structured-intake** — users add items an AI classifies/enriches into recorded fields.
- **human-review** — an AI proposal a human approves or rejects (ai-chat HITL).
- **pipeline-fanout** — one workflow's output creates many instances of another (`object[]` + `fanOut`).
- **git-work** — repo-backed work (worktree, worker with git tools, committed-work verification, merge).

**Completion criterion:** you can name the pattern and the section of reference.md you're copying. A request that fits a pattern but gets a novel shape is a redesign, not authoring.

### 3. Author — the session (the product path)

Use the definition editor's authoring session: describe the flow, and the agent converges on a `FlowBlueprint` with you (or lucky-mode one-shots it). The agent drafts the blueprint (`set_flow_blueprint`), runs the gate (`generate_definition`), and — when the flow needs custom logic — **implements the referenced files in-conversation** (`read_definition_file` / `write_definition_file`): the renderer emits a contract-typed stub per reference; the agent fills in the body and regenerates until the gate passes, then `save_definition` registers it. Hand edits to referenced files are authoritative — stub emission never overwrites them.

**Hand-author a preset** (in-repo, versioned): write the `FlowDefinition` in TypeScript following the conventions the schema-consistency check enforces (`defineWorkflow` anchor, `defineOperations`/`defineTool` maps, `satisfies FlowEdge`). Copy the structure from a preset; `presets/queen-bee/flow.ts` is the assembly reference (workflows + operations merged at the flow level). The legacy one-shot proxy path (`runGenerationLoop` / `POST /api/flows/definitions/generate`) still exists but is superseded by the session.

Every ai-task and ai-chat declares a `systemPrompt` naming the job and the completion tool; every ai-task that records data uses `completionOutput` + a sibling patch op; every displayed field (`instance`/`display` hints) has a writer.

**Completion criterion:** the definition declares a systemPrompt on every AI task, records structured output through completionOutput → patch, and has a needs-review escape hatch.

### 4. Run the gate

For generated flows the loop runs it. For hand-authored presets:

- `pnpm --filter workflow-engine test` and `pnpm --filter server test` — the schema-consistency suite covers presets; add the flow to the test's `PRESETS` list if it's a new built-in.
- `pnpm typecheck` — the per-definition typechecker and preset typecheck.
- The renderer corpus (`server/src/server/render-flow-definition.test.ts`) proves generated shapes render gate-clean — if your change touches the renderer, extend the corpus.

**Completion criterion:** `schema-consistency` reports zero errors and zero warnings for the definition, and the flow typechecks. Zero warnings is the bar — a "fields never read" or "written but never read" warning means the design leaks a field.

### 5. Verify the rendered UI

Every workflow's instances must show meaningful content: `instance: { title }` and `display: { fields }` for the fields that exist. A board groups by state; a `list`/`document`/`chat` view stacks instances. The UI renders task outputs via render hints when declared.

**Completion criterion:** you can say what an instance shows for each workflow state — its title and displayed fields — and every displayed field is written somewhere.

## Failure modes (positive targets, not prohibitions)

- **A prompt-less AI task** produces prose or fails fast — every AI task names its job and its completion tool.
- **A patch reading a field the completion contract can't produce** is undefined at runtime and the op fails — completionOutput declares exactly what the task returns; patches read those fields.
- **A record op that "succeeds" without data** silently fakes progress — the generated patch op fails when a sourced value is missing; gate its `taskError` into needs-review.
- **An instance with an empty payload** spawns a zombie auto-task on every boot — required createInstance fields reject empty values, and auto tasks seed from instance state.
- **A flow that can never finish** — states nothing reaches, or that can't leave, or transitions gated `never` — is caught by the structural-soundness warnings; treat them as blocking during authoring.
- **A gate firing before its inputs exist** — auto-transitions evaluate after each task, so a gate that reads a field an extractor writes must live in the state after the extractor, not the same state.
- **An undeclared import in a referenced file** fails the gate — declare every external package in the blueprint's `dependencies`; hand edits to referenced files are authoritative.

## Context pointers

- `skills/flow-authoring/reference.md` — the rendered knowledge: decisions, patterns, rules, vocabulary, capabilities. Read first.
- `server/src/server/flow-authoring/` — the source modules (single source of truth; regenerate reference.md with `pnpm --filter server export:flow-authoring` after editing the modules).
- `presets/queen-bee/` and `presets/wayfinder/` — canonical real flows.
- `CONTEXT.md` → Workflow Engine terms — the domain glossary.
- `server/src/server/schema-consistency.ts` — the check (reads/writes, structural soundness).
- `server/src/server/module-set.ts` — the module-set gate (structural lint, import policy, load, typecheck) for blueprint-referenced modules.
