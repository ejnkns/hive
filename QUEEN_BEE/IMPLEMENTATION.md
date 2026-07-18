# Queen Bee implementation plan

Implement in vertical slices. Each phase delivers a testable, user-visible increment. File names follow the fractal structuring pattern: kebab-case, one main export per file, same-named folders for private implementation.

## Phase 1 — project system and state [COMPLETE]

### Delivered

- `shared/src/project-types.ts` — `ProjectListItem` and `CreateProjectRequest` types
- `server/src/server/queen-bee.ts` — module entry point
- `server/src/server/queen-bee/create-project-store.ts` — factory, holds `Project`/`ProjectRegistry`/`ProjectStore` types
- `server/src/server/queen-bee/create-project-store/create-project.ts` — validates git repo, inits `.hive/project.json`, adds to registry
- `server/src/server/queen-bee/create-project-store/unlink-project.ts` — removes from registry, preserves `.hive/`
- `server/src/server/queen-bee/create-project-store/load-project-registry.ts` — reads `~/.hive/project-registry.json`
- `server/src/server/queen-bee/create-project-store/write-project-registry.ts` — atomic registry writes
- `server/src/server/queen-bee/project-routes.ts` — `POST/GET/DELETE /api/queen-bee/projects`
- `ui/src/ui/queen-bee/project-overview.svelte` — project list, create, unlink buttons
- `ui/src/ui/queen-bee/create-project-form.svelte` — repo path + name input
- `server/src/main/start-server.ts` — creates project store, registers Queen Bee routes
- `ui/src/ui/App.svelte` — Queen Bee as default view, proxy dashboard at `/#/dashboard`

### What the user gets

Open the UI, see a project overview with a list of linked projects. Create a new project by providing a git repo path. Unlink a project. Clicking a project shows a placeholder for the kanban board (coming in Phase 3).

### Implementation steps

**1a. Types and schema**

Define the `Project` type and registry structure. Types are colocated with the files that own them — no standalone `types.ts`.

`Project` (lives in `create-project.ts`):
```typescript
type Project = {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  systemPrompt: string;
  codingGuidelines: string;
};
```

Registry format (`~/.hive/project-registry.json`):
```json
{
  "projects": {
    "<project-id>": {
      "path": "/absolute/path/to/repo"
    }
  }
}
```

**1b. File structure**

```
server/src/server/queen-bee.ts                       — module entry point
server/src/server/queen-bee/
  create-project-store.ts                            — factory returning a ProjectStore
  create-project-store/
    create-project.ts                                — validate path, init .hive/, write project.json, register
    unlink-project.ts                                — remove from registry, preserve .hive/ on disk
    load-project-registry.ts                         — read ~/.hive/project-registry.json
    write-project-registry.ts                        — atomic write to registry
  project-routes.ts                                  — fastify route handlers (POST/GET/DELETE /api/queen-bee/projects)

shared/src/project-types.ts                          — HTTP request/response types for the API
```

**1c. Project store**

`create-project-store()` reads the registry from disk, returns a `ProjectStore`:

```typescript
type ProjectStore = {
  getAll(): Project[];
  getById(id: string): Project | undefined;
  create(repoPath: string, name?: string): Project;
  unlink(id: string): void;
};
```

- `create()` validates the path is a git repo, generates an id, initializes `.hive/project.json`, adds to registry, writes registry atomically.
- `unlink()` removes from registry, writes registry atomically. Does not touch `.hive/` on disk.
- `getAll()` returns projects in insertion order. Reads `.hive/project.json` for each to populate `systemPrompt`/`codingGuidelines`.

**1d. API routes**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/queen-bee/projects` | Create project. Body: `{ path: string, name?: string }` |
| `GET` | `/api/queen-bee/projects` | List all projects |
| `DELETE` | `/api/queen-bee/projects/:projectId` | Unlink project |

All routes go through the same Fastify server as existing routes. No separate Queen Bee auth.

**1e. UI**

```
ui/src/ui/queen-bee/
  project-overview.svelte                           — list of projects, create/unlink buttons
  create-project-form.svelte                        — path input + name input, auto-validates git
```

The main app (`App.svelte`) shows the project overview by default. The existing proxy dashboard components move to `/#/dashboard`. Phase 1 adds a simple route switch at the top level.

**1f. Wire into server startup**

In `start-server.ts`, create the project store and register routes directly on the Fastify server via `registerProjectRoutes()`. The orchestrator wiring remains (removed in Phase 4).

### Deliverable

Create a project from the UI, see it in the overview, unlink it. `.hive/project.json` appears in the repo. `~/.hive/project-registry.json` tracks linked projects.

---

## Phase 2 — devise engine [COMPLETE]

### Delivered

- `server/src/server/queen-bee/devise-engine.ts` — factory, holds `DeviseSession` map, `start`/`respond` with tool loop
- `server/src/server/queen-bee/devise-engine/devise-system-prompt.ts` — grilling-style system prompt with codebase exploration mandate
- `server/src/server/queen-bee/devise-engine/create-devise-model-caller.ts` — wraps `handleChatCompletion`, SSE parsing with tool call support
- `server/src/server/queen-bee/devise-engine/devise-tools.ts` — four tools: `update_requirements`, `list_directory`, `read_file`, `search_code`
- `server/src/server/queen-bee/devise-routes.ts` — `POST /start`, `POST /respond`, `GET /status`, `GET /requirements`
- `server/src/server/queen-bee/create-project-store/create-project.ts` — creates `.hive/requirements.md` template at project creation
- `ui/src/ui/queen-bee/devise-chat.svelte` — chat interface with message history, "Approve Plan" inside Queen Bee message bubble on completion, input always visible
- `ui/src/ui/queen-bee/project-page.svelte` — project detail page at `/#/project/:projectId`, sticky header with "View Requirements" toggle, planning state with error/retry, DeviseChat always visible when no board
- Tests: project store (8 tests), devise engine (8 tests), devise tools (15 tests)

### What the user gets

Click into a project, enter an initial prompt, answer AI-generated clarifying questions in a chat-like interface. An empty `.hive/requirements.md` template exists from project creation (section headings only, no placeholder text). The "View Requirements" button is immediately visible in the sticky header. During the devise session, the model calls `update_requirements` to write incremental drafts — the user can toggle the overlay panel to see live updates. When the model signals `REQUIREMENTS_COMPLETE`, an "Approve Plan" button appears inside the Queen Bee message bubble. The user can click it to trigger the planner and transition to the kanban board, or continue the conversation using the always-visible input box.

### Implementation steps

**2a. Devise session manager**

A stateful session manager holds in-progress devise sessions in memory (one per project). Each session tracks:
- The conversation messages (system prompt + user/assistant turns)
- The project ID
- Whether the session is active or complete

Sessions are created on `start` and destroyed on `complete` or timeout.

**2b. System prompt**

The devise system prompt follows the conversational interview pattern from the Wayfinder skill. It instructs the model to:
- Ask one clarifying question at a time, breadth-first across the whole space
- Explore edge cases, scope boundaries, and technical constraints
- Call `update_requirements` after every significant user answer to keep the live document in sync
- Signal completion by writing `REQUIREMENTS_COMPLETE` on its own line at the end of a response
- Continue the conversation after completion until the user explicitly approves

The prompt is a single string constant — no predefined question templates.

**2c. File structure**

```
server/src/server/queen-bee/
  devise-engine.ts                     — factory, holds session state, start/respond with tool loop
  devise-engine/
    devise-system-prompt.ts           — the system prompt constant
    create-devise-model-caller.ts     — wraps handleChatCompletion, SSE parsing with tool call support
    devise-tools.ts                   — tool definitions and execution (update_requirements, list_directory, read_file, search_code)
  devise-routes.ts                     — POST /start, /respond, GET /status, GET /requirements
```

**2d. REST endpoints**

`POST /api/queen-bee/:projectId/devise/start` — starts a devise session
- Body: `{ prompt: string }`
- Server: creates session, calls model with system prompt + initial prompt
- Response: `{ question: string }` — the model's first clarifying question

`POST /api/queen-bee/:projectId/devise/respond` — sends user's answer
- Body: `{ answer: string }`
- Server: appends answer to conversation, calls model with tool loop. The `update_requirements` tool writes `.hive/requirements.md` mid-session as the model refines the spec.
- If model asks another question: returns `{ question: string }`
- If model signals `REQUIREMENTS_COMPLETE`: returns `{ complete: true, spec: string }` (the file was already written by the tool; the route reads it back)
- Also emits `devise_question` or `devise_complete` via WebSocket

**2e. Model calling**

The devise engine uses the existing proxy via `handleChatCompletion`. Follows the same pattern as the orchestrator's `ModelCaller`. Model calls use streaming; the server accumulates the full response before returning (the user doesn't need to stream — they get the full question at once).

**2f. WebSocket events**

Two new event types sent over the existing WebSocket:
```typescript
{ type: "devise_question", projectId: string, question: string }
{ type: "devise_complete", projectId: string, spec: string }
```

**2g. UI**

```
ui/src/ui/queen-bee/
  devise-chat.svelte                  — chat interface with message history and input
```

When the user navigates to a project page at `/#/project/:projectId`:
- The "View Requirements" button is in the sticky header immediately (`.hive/requirements.md` exists from project creation as an empty template). Clicking it toggles an overlay panel showing the requirements content.
- DeviseChat is the main content area (always shown when no kanban board exists). The user enters their initial prompt here.
- During the session, the model's `update_requirements` calls write live drafts to disk. The user can open the requirements overlay to see updates in real time.
- When the model signals `REQUIREMENTS_COMPLETE`, an "Approve Plan" button appears inside the Queen Bee message bubble (the completion message). The user input box remains visible so they can continue the conversation to refine further.
- On approve, `POST /plan` runs the planner. A "Generating cards..." state is shown during planning. On success, the page transitions to the kanban board. On failure, an error bar with a "Retry" button is shown.

**2h. Read-only workspace tools plus update_requirements**

During the devise session, the model has access to a constrained tool set:
- `update_requirements` — writes the full requirements document to `.hive/requirements.md` (replaces entire file). The model calls this after every significant user answer to keep the document current.
- `list_directory` — explore project structure
- `read_file` — inspect relevant files
- `search_code` — find patterns in the codebase

### Deliverable

Enter a prompt, answer questions interactively, receive a structured requirements document saved in `.hive/requirements.md`.

---

## Phase 3 — planner and kanban board [COMPLETE]

### What was delivered

- Board store, planner, board routes, kanban UI with 6 columns, card detail overlay
- `save-board.ts` persists all card fields (description, acceptanceCriteria, relevantFiles, dependencies, workerLog) to `board.json`
- "View Requirements" toggle button in sticky project page header (requirements accessible as an overlay panel, not a card)
- "Approve Plan" button appears inside the Queen Bee message bubble when session reaches completion
- Guided replan: inline text input on kanban board lets user provide guidance for the planner instead of blind rerolling
- Planner enforces at least 1 relevant file per card (validated server-side, surfaces error on failure)
- Planner accepts optional `guidance` parameter from `POST /plan`, appended to the model prompt
- Planner uses codebase exploration tools (list_directory, read_file, search_code) before generating cards, populating relevantFiles with real observed paths
- Planner system prompt generates feature-level cards (not implementation steps), 1-5 per doc

### Implementation steps

**3a. Board and card types**

Define types for the kanban board state:

```typescript
type Column = "idea" | "ready" | "in_progress" | "reviewing" | "done" | "unfulfillable";

type Card = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  relevantFiles: string[];
  dependencies: string[];       // card IDs this card depends on
  column: Column;
  createdAt: string;
};

type Board = {
  projectId: string;
  cards: Card[];
};
```

**3b. File structure**

```
server/src/server/queen-bee/
  board-store.ts                       — factory, reads/writes .hive/board.json + cards/
  board-store/
    load-board.ts                      — reads board state from .hive/
    save-board.ts                      — atomic writes to .hive/board.json
    save-card.ts                       — writes individual card .json
  planner.ts                           — model-driven requirements → cards decomposition
  planner/
    plan-system-prompt.ts              — planner system prompt
  board-routes.ts                      — GET board, POST move card, POST create card
  board-websocket.ts                   — WebSocket event broadcasting
ui/src/ui/queen-bee/
  kanban-board.svelte                  — six-column board layout
  kanban-card.svelte                   — individual card display
  card-detail.svelte                   — expanded card view with description, criteria, files
```

**3c. Planner**

The planner takes `.hive/requirements.md` and an optional user guidance string. Before generating cards, the planner explores the codebase using read-only tools (list_directory, read_file, search_code) to ground file paths in actual repo exploration rather than guessing from requirement text alone. The workflow:

1. Read `requirements.md` from the project's `.hive/` directory
2. Construct prompt: "Explore the codebase... then generate cards from this requirements document: <requirements>". If `guidance` is provided, append "Planner guidance: <guidance>" to the prompt.
3. Call a model with a planner system prompt + requirements + guidance, with tools enabled for codebase exploration
4. The model explores: project structure, package.json, existing code patterns relevant to each requirement
5. Model produces a JSON array of cards:
   - Each card has: title, description, acceptance criteria, relevant file paths (populated from observed paths), dependency edges
   - Cards are small enough for single worker loops
   - Dependency edges form a flat DAG (no parent-child nesting)
6. Output is validated locally: malformed output causes an error. Cards with empty `relevantFiles` are rejected with a descriptive error.
7. Cards written to `.hive/board.json` (all fields) and `.hive/cards/<card-id>.json`
8. All cards start in the **idea** column

**3d. Board API**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/queen-bee/:projectId/board` | Full board state with all cards |
| `POST` | `/api/queen-bee/:projectId/cards` | Create a card manually |
| `PATCH` | `/api/queen-bee/:projectId/cards/:cardId` | Move card to a different column |
| `POST` | `/api/queen-bee/:projectId/plan` | Trigger planner from requirements.md. Body: `{ guidance?: string }` |

**3e. WebSocket events**

```typescript
{ type: "board_update", projectId: string, board: Board }
{ type: "card_updated", projectId: string, card: Card }
```

Follow the existing broadcast pattern in `assign-routes.ts`. When a card is created or moved, the updated board state is pushed to all connected clients. WebSocket is a nice-to-have for Phase 3 — REST fallback (polling) works for single-user.

**3f. UI**

The project page (`project-page.svelte`) has a sticky header with a "View Requirements" toggle overlay. Shows DeviseChat when no board exists, or KanbanBoard when cards are present.

- `kanban-board.svelte` — six columns rendered horizontally, cards in columns, scrollable. "Replan" button toggles an inline textarea for user guidance before regenerating cards. Shows "Generating..." state during planning, replan-specific error bar on failure.
- `kanban-card.svelte` — compact card with title, description preview, dependency indicator, column color
- `card-detail.svelte` — slides open when card is clicked: description, acceptance criteria, relevant files, dependencies, worker log, actions (move to column, run worker)

**3g. Card movement rules**

- **idea → ready**: only after requirements are defined (card has description + criteria filled in from planner or manual editing)
- **ready → in_progress**: user action (Phase 4 wires up worker dispatch)
- **in_progress → reviewing**: happens automatically when worker finishes (Phase 4)
- **reviewing → done/in_progress**: reviewer verdict (Phase 5)
- **any → unfulfillable**: worker dead-end handover (Phase 6)

**3h. Planner triggering**

The planner runs when the user clicks "Approve Plan" in DeviseChat after the model signals `REQUIREMENTS_COMPLETE` (first run), or via the "Replan" button on the kanban board (iterative refinement). Replan shows an inline text input where the user can provide guidance ("What should the planner change?") before generating. Guidance is optional — leaving it blank does a blind reroll. Re-running the planner overwrites existing cards with user confirmation.

### Deliverable

See a populated kanban board after a devise session. View card details. Move cards between columns manually. Manually create cards.

---

## Phase 4 — worker agent loop [COMPLETE]

### Status assessment

Core complete. Worker can implement code, events stream to UI, reviewer auto-invoked after completion. 5 polish items deferred.

**Already working:**

- Worker supervisor: `run()`, `runLoop()` with max 20 iterations via `createDeviseModelCaller(WORKER_TOOLS)`, cancel via `AbortController`
- Worker tool set: `update_requirements`, `list_directory`, `read_file`, `search_code`, `write_file`, `run_command`
- Worker system prompt: dedicated `worker-system-prompt.ts` with codebase exploration, git workflow, completion/error handover, `HANDOVER` schema for dead-ends
- Git operations: `createWorktree`, `createBranch`, `commitChanges` (also `getDiff`, `getCurrentBranch`, `removeWorktree`)
- Worker context builder (`build-worker-context.ts`): system prompt + card task prompt + reviewer feedback on retry
- Validation pass: reads all `relevantFiles` before run loop, moves card to `unfulfillable` if files missing
- Worker route: `POST .../run` with card state validation, `POST .../cancel` for aborting running workers
- Reviewer auto-invoked: `runReviewer()` in worker-supervisor after commit, stores verdict, emits via WebSocket
- WebSocket endpoint: `GET /api/queen-bee/ws` — broadcasts `worker_progress`, `worker_complete`, `reviewer_verdict`, `board_updated`, `projects_changed`
- Card detail UI: "Run Worker" / "Retry Worker" button, reviewer verdict and feedback display
- Kanban card UI: colored pass/fail badge on reviewed cards
- Worker log storage: `WorkerLog` + `ReviewerLog` types in shared/board types, persisted to `board.json`

### Prioritized implementation plan

#### Blockers (worker cannot work) [COMPLETE]

1. ~~**Worker tool set**~~ — Created `worker-tools.ts` with `WORKER_TOOLS` combining all devise tools plus `write_file` and `run_command`. `createDeviseModelCaller()` now accepts optional `tools` parameter. Worker supervisor uses `WORKER_TOOLS` and `executeWorkerTool()`.

2. ~~**Worker system prompt**~~ — Created `worker-system-prompt.ts` with instructions for codebase exploration, implementation conventions, git workflow, completion summary, and error handover. Integrated into `build-worker-context.ts` as primary system message.

3. ~~**Fix `projectId` bug**~~ — Now resolved from `boardStore.getBoard("", repoPath).projectId`.

4. ~~**Fix `writeWorkerLog` board corruption**~~ — Now reads full board via `getBoard()`, updates the specific card's `workerLog`, saves all cards back via `saveCards(board.cards)`.

#### Critical path (end-to-end flow) [COMPLETE]

5. ~~**WebSocket wireup**~~ — Created `worker-event-bus.ts` module-level event emitter. `start-server.ts` wires `onWorkerEvent` to `emitWorkerEvent`. `worker-routes.ts` registers `GET /api/queen-bee/ws` WebSocket endpoint that subscribes to the event bus and forwards events to connected clients as `{ type: "worker_event", data: { projectId, ...event } }`.

6. ~~**Validation pass**~~ — `validateCard()` in `worker-supervisor.ts` checks that all `card.relevantFiles` exist in the worktree. Missing files cause the card to move to `unfulfillable` with a descriptive error.

7. ~~**Cancel/stop endpoint**~~ — `POST /api/queen-bee/:projectId/cards/:cardId/cancel` added to `worker-routes.ts`. `cancel()` method added to `WorkerSupervisor`. Uses `AbortController` per running worker. On cancel, the controller is aborted and removed from the map.

#### Polish [DEFERRED]

8. **`git_diff` and `git_status` as model-callable tools** — `git-operations.ts` already has `getDiff()` and `getCurrentBranch()`. Add `git_status` and `git_diff` tool definitions to `WORKER_TOOLS` in `worker-tools.ts` with implementations that wrap the existing git operations. The worker can then call them directly to check its progress and produce better commit messages. Implementation: add tool definitions with `git status` (calls `git diff --stat`) and `git diff` (calls `getDiff`), wire in `executeWorkerTool` switch.

9. **Inline run button on KanbanCard** — Currently accessible only via CardDetail modal. Add a compact "▶" button to `kanban-card.svelte` for `ready`/`in_progress` cards, calling the same `POST .../run` endpoint. Requires: new `onRun` prop on KanbanCard, wired from kanban-board's `handleRunCard`.

10. **Worktree cleanup** — `git-operations.ts` has `removeWorktree()` already. Currently called only at the start of a new run (cleans up previous worktree). Add cleanup when card reaches `done`: call `removeWorktree(repoPath, card.id)` in the reviewer's pass path. Preserve worktrees on `unfulfillable`/error for inspection.

#### Decommission (final step of Phase 4) [DEFERRED]

11. **Branch summary and PR creation** — After worker commit, call model (reuse `createDeviseModelCaller`) with a short prompt: "Summarize what was implemented on branch `qb/<cardId>` in 2-3 sentences." Store summary on card. If git remote exists: `git push origin qb/<cardId>` + `gh pr create --title "<card.title>" --body "<summary>"`. Store PR URL on card.

12. **Remove old orchestrator** — Files to delete: `server/src/server/orchestrator/` (17 files). Remove `POST /api/orchestrate` from `assign-routes.ts` (line ~415). Remove orchestrator WebSocket event handling in `assign-routes.ts`. Remove `BottomDrawer`/`OrchestratorPanel` from `App.svelte`. Remove orchestrator store (`use-orchestrator.svelte`). Remove orchestrator-related CSS classes.

---

## Phase 5 — reviewer agent [COMPLETE]

### Status

Complete. Reviewer runs automatically after worker completion, emits WebSocket verdict, feedback injected into retry context. Card movement rules enforced.

### What was delivered

- `reviewer.ts` — factory, calls model with git diff + card criteria, parses `VERDICT: pass|fail` + `FEEDBACK:` from response
- `reviewer/reviewer-system-prompt.ts` — instructions for code-and-diff inspection only, structured output format
- `ReviewerLog` type added to `shared/board-types.ts`, `board-store.ts` Card, `save-board.ts`, `load-board.ts`, `save-card.ts`
- Worker supervisor invokes reviewer after successful commit: computes `git diff HEAD~1`, calls reviewer, stores `reviewerLog` on card
- On pass: card → done, `reviewer_verdict` WebSocket event emitted. On fail: card → in_progress with feedback, `reviewer_verdict` event emitted.
- Worker retry context: `build-worker-context.ts` injects "Previous Review Feedback" section when card has a failed `reviewerLog`
- Card movement enforcement: idea→ready validated in `board-routes.ts` PATCH handler (requires description + ≥1 acceptance criterion)
- Worker handover schema: system prompt enforces `HANDOVER / PROBLEM / ATTEMPTED / BLOCKED_BY` format when blocked
- WebSocket event types aligned with ARCHITECTURE.md: `worker_progress`, `worker_complete`, `reviewer_verdict`, `board_updated`, `projects_changed`
- UI: `card-detail.svelte` shows reviewer verdict (Passed/Failed) with feedback. `kanban-card.svelte` shows colored pass/fail badge.

### Implementation steps

1. ~~**Reviewer agent**~~ — `reviewer.ts`: model call with `REVIEWER_SYSTEM_PROMPT` + git diff (truncated to 8000 chars) + card criteria. Parses `VERDICT:` and `FEEDBACK:` from response.

2. ~~**Structured verdict**~~ — Produces `ReviewerVerdict { verdict, feedback }`. Pass/fail determined by `VERDICT:` prefix, feedback from `FEEDBACK:` section.

3. ~~**Pass → done**~~ — `runReviewer()` moves card to `done` on pass. (Worktree cleanup deferred to Phase 4 polish #10.)

4. ~~**Fail → in_progress with feedback**~~ — Card moves back to `in_progress`, `reviewerLog` stored with verdict and feedback.

5. ~~**UI reviewer verdict**~~ — Card detail shows "Passed"/"Failed" with colored text and feedback. KanbanCard shows small pass/fail badge.

6. ~~**Worker context incorporates reviewer feedback on retry**~~ — `build-worker-context.ts` now includes "Previous Review Feedback" section when card has a `reviewerLog` with `verdict: "fail"`. The feedback is injected into the worker's task prompt so it knows what went wrong last time.

---

## Phase 6 — Coordinator and unfulfillable handling

### What the user gets

When a worker hits a dead end, it produces a structured handover. The Coordinator analyzes the problem against the full spec and suggests remediation options. The user chooses: accept fix, re-devise, or archive.

### Implementation steps

1. Implement worker dead-end detection: worker produces structured handover (`{ problem, attempted, blockedBy }`).
2. Card moves to **unfulfillable**.
3. Coordinator analyzes handover against `.hive/requirements.md` using a model call.
4. User receives suggestions and chooses action via UI.
5. UI shows unfulfillable cards with handover summary and suggested remediations.

### Deliverable

A worker hitting a roadblock creates an unfulfillable card with actionable user options.

---

## Phase 7 — parallel workers

### What the user gets

Start multiple workers simultaneously when cards have no dependency conflicts. Each runs in its own worktree. Merge conflicts flagged to the user.

### Implementation steps

1. Implement parallel worker dispatch: start multiple workers when non-conflicting cards are in **in progress**.
2. Each worker gets its own worktree.
3. Detect merge conflicts during PR creation.
4. Flag conflicts to the user in the UI with context about which branches conflict.
5. Add a concurrency limit (configurable, default 3).

### Deliverable

Two cards run simultaneously in isolated worktrees. Merge conflict surfaced to user when it occurs.

---

## Phase 8 — polish and cleanup

### What the user gets

Full card detail views, project dashboard, dependency visualization, manual card management. Complete project management experience.

### Implementation steps

1. Card detail view: full streaming log, git branch link, reviewer feedback history, tool call log.
2. Project dashboard: summary stats (cards per column, active workers, recent activity).
3. Manual card creation and editing.
4. Card-to-card dependency visualization on the board.
5. Archive/unlink project flow from UI.
6. Remove all old orchestrator references from UI and server.
7. Move proxy dashboard UI to `/#/dashboard`.

### Deliverable

A complete project management experience with AI workers, replacing the old orchestrator entirely.

---

## Engineering notes

- Prefer pure state-transition functions with I/O at the edges.
- Use `AbortSignal` end-to-end for worker cancellation.
- State files use atomic writes (write to temp file, then rename) to prevent corruption.
- Model calls for devise, planning, workers, coordinating, and reviewing all go through the existing proxy layer — no special paths.
- The existing tool registry (`createLocalToolRegistry`) can be repurposed for workers (adds git operations).
- Keep the proxy layer untouched — Queen Bee is a layer above it, not inside it.
- Board state and card files are committed to git alongside user code; they are source-of-truth project artifacts.
- All files follow the fractal structure: kebab-case, one main export, same-named folders for private implementation, no index files.
