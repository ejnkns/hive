# UI Build-Out — Implementation Plan

> Status: historical. The phases shipped across subsequent initiatives
> (definition-driven rendering, the flow editor as a flow instance — see
> `CONTEXT.md` and `docs/plan-editor-as-flow-instance.md`). The field renderer
> is now `<config-field-control>` (one renderer for every form surface);
> `ConfigFieldInput.svelte` was deleted.

Build out the flows UI. The rendering surface is already cleanly split — the
app shell (library, definition editor, forms, proxy dashboard) is Svelte; the
rendering surface (how workflow instances render) is Lit + Web Components
(`CONTEXT.md` → "Definition-Driven Rendering terms"). That split is correct and
stays. What is missing is *depth*: the surface renders any flow, but shallowly —
flat sections, stacked cards, plain-text outputs, no derived views.

This plan deepens the surface generically (no per-flow special-casing), polishes
the app shell, adds the declarative view hints VISION's "the definition IS the
layout" calls for, and covers the work with UI tests and the pending end-to-end
DoD pass.

Working branch: `engine`. The wayfinder preset is merged in.

## Status: plan approved, implemented

Implemented on the `engine` branch (August 2026): Phases A–D1 shipped as scoped
commits, and the D2 manual browser pass ran (both flows, queen-bee card pass +
wayfinder) — it surfaced engine-level bugs that were fixed afterward (the
validation retry loop dead guard, tools skipping hidden domain state, the
one-shot worker chat accepting input, and Integrate blocked by the flow's own
untracked domain state; see the ROADMAP "engine completion & verification
capabilities" entry). Automated verification is green: `pnpm -r typecheck`, the
UI test suite (47 pure + 33 component tests), the server suite (202 tests), the
engine suite (162 tests), `pnpm --filter ui build`, and biome on changed files.

Scope locked before writing this plan:

- **The Svelte/Lit split is settled and not revisited.** App shell = Svelte;
  rendering surface = Lit. Only `LitFlowHost` crosses the seam (as the adapter).
- **Generic-first.** Every rendering change must work for any flow from the
  definition + instance state alone. Nothing may reference queen-bee or wayfinder
  by name in the rendering surface.
- **Views are derived.** The board is workflow instances grouped by state; the
  requirements view is the workflow's persisted output; nothing is a second
  stored copy (VISION #5).
- **Schema changes are additive and optional.** `ConfigField.options` and
  `WorkflowConfig.ui.view` are optional hints with unchanged behavior when
  absent.

---

## Phase A — Rendering-surface depth (Lit, no engine change)

The "very basic" fix. All of it is derived rendering from the workflow definition
and instance state.

### A1. State-column board (`workflow-instances.ts`)

Currently instances group only by `workflowId`, then stack vertically
(`workflow-instances.ts:67`). Change: within each workflow section, split
instances into **columns by `currentState`**, ordered by the workflow's
`states` array, headers = state label + count, styled by `state.category`
(initial/active/terminal/error). Empty columns render dimmed so the full
lifecycle is visible. This makes queen-bee's cards a real board
(Ready / In Progress / Reviewing / Done / Unfulfillable) and wayfinder's tickets
a kanban (fog / ready / resolving / recording / closed / out-of-scope) with no
per-flow code.

### A2. Collapsible workflow sections

Each workflow section header: label + instance count + a running pulse when any
instance has a running task. Collapse toggle, state persisted to localStorage
keyed by flow id + workflow id.

### A3. Card content depth (`workflow-instance-card.ts`)

- **Markdown for task outputs.** String outputs and outputs with a string
  `content` render via `markdown-view` (the `render` hint already opts in; add a
  heuristic for the no-hint case instead of the current truncated `text-view`).
- **Lifecycle dots.** A compact strip derived from the instance's
  `state.history` `state_transition` entries showing the path to the current
  state (mirrors the dashboard's stage-path idea; minimal, dropped if it does
  not render cleanly).
- **Domain-data polish.** Existing key/value display stays; add JSON pretty +
  copy on hover; keep it light.
- **Action ordering.** Primary variant actions first.

### A4. Chat and task polish

- **`chat-session.ts`:** render message bodies through markdown, render
  `tool_calls` as compact chips/cards, style roles, disable send while pending,
  auto-scroll on new messages.
- **`agent-progress.ts` / `operation-status.ts`:** current step text, spinner,
  inline error.

---

## Phase B — App shell polish (Svelte)

### B1. Flow library (`FlowLibrary.svelte`)

Search (name/description), built-in vs user filter, instance-count badges,
loading skeletons instead of a bare "Loading flows...".

### B2. Instantiate form + config field inputs

- Engine: add optional `options?: string[]` to `ConfigField`
  (`workflow-engine/src/workflow-types.ts`). Server validation unchanged (still a
  string). Serialized to the client via the existing definition payload.
- UI: `config-field-control` (Lit) renders a `Select` when `field.options` is
  present. Seed `options` on wayfinder's ticket `type` field and queen-bee where
  it reads as an enum.
- Better hint copy for `basePath` (destination repo/scratch dir).

### B3. Definition editor (`DefinitionEditor.svelte`)

- Syntax highlighting for the TS source (tokenizer-based, no heavyweight editor
  dependency unless justified).
- Inline transpile/validation error feedback on Save (surface the server's
  validation error in-editor rather than a banner only).
- Dirty-state guard on navigation away with unsaved changes.

### B4. Instance page (`FlowInstancePage.svelte`)

- Flow-level action buttons get pending/disabled states while a dispatch runs.
- A compact per-workflow instance-count summary in the header.

---

## Phase C — Declarative views (engine schema)

### C1. `WorkflowConfig.ui.view`

Add `view?: "board" | "list" | "document" | "chat"` to `WorkflowConfig.ui`.
The renderer honors it with fallback to Phase A's grouped-by-state default.
Serialize it through `getWorkflowDefinitions()`. Seed the hints:

- queen-bee: cards → `board`, requirements → `document`, ideas → `list`,
  onboarding/integration → `list`.
- wayfinder: tickets → `board`, build-items → `board`, charting/build → `list`.

### C2. Custom components (later phase, architected-for)

Served-at-runtime Lit components via `ui.instanceComponent` and custom render
kinds (`ui.kinds`). Registry and input contracts already exist; this phase is
building the serving/hosting path. Out of scope for this initiative.

---

## Phase D — Testing + verification

### D1. UI tests (`node --test`, the UI's existing runner)

- The new grouping/column logic (pure function extracted from `workflow-instances`).
- `flow-store.applyMessage` (init/upsert/remove).
- `resolve-path`.
- `markdown-view` sanitization (raw HTML dropped).
- `config-field-control` select rendering for `options` fields.

### D2. End-to-end DoD pass

`pnpm dev` boots; `#/flows` lists queen-bee and wayfinder; author/instantiate/
open a definition; queen-bee card pass (worker edits land, accept merges); a
wayfinder ticket pass (add → graduate → claim → resolve → build).

---

## Definition of done

- queen-bee cards render as a state-column board; wayfinder tickets as a kanban;
  both generic (no per-flow code in the rendering surface).
- Workflow sections are collapsible and show run state.
- Task outputs render markdown; chat shows tool calls and roles cleanly.
- Library is searchable; instantiate forms use selects for option-constrained
  fields; the editor highlights TS and surfaces validation errors inline.
- `ConfigField.options` and `WorkflowConfig.ui.view` ship as optional additive
  schema fields, serialized to the client, honored by the renderer, seeded on
  both presets.
- `pnpm -r typecheck`, biome on changed files, and the UI test suite stay green;
  the D2 manual pass completes.

## Commits (one per logical unit, biome-formatted, scoped messages)

1. `ui: render workflow instances as state-column boards` (A1 + grouping test)
2. `ui: make workflow sections collapsible and run-aware` (A2)
3. `ui: render task outputs as markdown and add lifecycle dots` (A3)
4. `ui: render chat tool calls and markdown messages` (A4)
5. `ui: add search and filters to the flow library` (B1)
6. `engine,ui: support ConfigField.options and render selects` (B2)
7. `ui: highlight definition source and surface validation errors inline` (B3)
8. `ui: add pending states and instance counts to the flow page` (B4)
9. `engine,presets,ui: declare workflow views and seed them` (C1)
10. `ui: cover the surface with tests` (D1)
