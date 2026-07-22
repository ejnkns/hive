# Queen Bee — UI Integration Guide

A new UI consuming the Queen Bee server needs three things: a **boot endpoint**, a single **WebSocket** stream, and **POST commands**. No polling, no N+1 fetches, no protocol inference. All typed contracts live in `shared/`.

---

## 1. Boot

```typescript
// List projects
const projects: ProjectListItem[] = await fetch("/api/queen-bee/projects").then(r => r.json());

// Determine what view to render (single round-trip, no probing)
const phase: ProjectPhase = await fetch(`/api/queen-bee/${projectId}/phase`).then(r => r.json());

// If phase is "board", load the full board for initial render
const board: Board = await fetch(`/api/queen-bee/${projectId}/board`).then(r => r.json());
```

The shape of `phase`:

```typescript
type ProjectPhase =
  | { phase: "no_requirements" }
  | { phase: "requirements"; session: { status; kind; draftRequirements?; messages[] }; requirementsContent: string | null }
  | { phase: "planning"; outcome: { proposal } | { feedback }; requirementsContent: string | null }
  | { phase: "board"; requirementsContent: string; hasBoard: boolean }
```

State machine: `no_requirements → requirements → planning → board`. Phase transitions arrive via WebSocket events.

---

## 2. WebSocket

Open **one** connection per project page, close on unmount. Reconnect with exponential backoff.

```typescript
const ws = new WebSocket(`ws://${host}/api/queen-bee/ws`);

ws.onmessage = (e) => {
  const event: QueenBeeEvent = JSON.parse(e.data);

  switch (event.type) {
    // Full board snapshot — apply directly, skip HTTP
    case "board_snapshot":
      applyBoard(event.board);  // event.board is Board, no cast needed
      break;

    // Card lifecycle — patch local state or refetch board
    case "card_moved": break;           // { cardId, column }
    case "card_accepted": break;        // { cardId }
    case "card_changes_requested": break; // { cardId }
    case "card_unfulfillable": break;   // { cardId, handover } — show outside board

    // Planning and board structure
    case "cards_created": break;        // { cardIds[] }
    case "ideas_changed": break;        // { ideas }
    case "planning_outcome": break;     // { outcome } — switch view
    case "integration_changed": break;  // { status }

    // Live drafts during Requirements Agent execution
    case "draft_updated": break;        // { scope, scopeId?, content } — intermediate
    case "draft_finalized": break;      // { scope, scopeId?, content } — authoritative, stop WS updates

    // Worker progress — live streaming
    case "card_worker_progress": break; // { cardId, iteration, toolCalls[], content? }
    case "card_review_complete": break; // { cardId, verdict }

    // Project list changes
    case "projects_changed": break;
  }
};
```

Every event has `version: number` for staleness detection. Each `type` is a discriminator — TypeScript narrows automatically.

**State after boot never needs HTTP.** Board changes arrive via `board_snapshot`. Card-level events let you patch specific cards without reloading.

---

## 3. Commands

All mutation endpoints are `POST`. Responses use the `ApiResponse<T>` wrapper:

```typescript
type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string };
```

### Requirements

```
POST /api/queen-bee/:pid/requirements/start    { prompt }
    → ApiResponse<{ question, draftRequirements }>

POST /api/queen-bee/:pid/requirements/respond  { answer }
    → ApiResponse<{ question } | { complete, spec, draftRequirements }>

POST /api/queen-bee/:pid/requirements/approve  {}
    → planning_outcome arrives via WS

POST /api/queen-bee/:pid/requirements/revision/start  { prompt }
    → ApiResponse<{ question, draftRequirements }>
```

### Planning

```
POST /api/queen-bee/:pid/planning/:proposalId/changes/:changeId
    body: { decision: "accepted" | "rejected" }
    → ApiResponse<PlanningProposal>

POST /api/queen-bee/:pid/planning/:proposalId/accept-all  {}
    → ApiResponse<{ cards[], integration }>

POST /api/queen-bee/:pid/planning/:proposalId/apply  {}
    → cards_created arrives via WS

POST /api/queen-bee/:pid/planning/:proposalId/replan  { guidance }
    → ApiResponse<PlanningProposal>

POST /api/queen-bee/:pid/planning/:proposalId/cancel  {}
```

### Cards

```
POST /api/queen-bee/:pid/cards/:cardId/run              {}
    → ApiResponse<{ started }>
    → card_worker_progress arrives via WS

POST /api/queen-bee/:pid/cards/:cardId/cancel           {}

POST /api/queen-bee/:pid/cards/:cardId/accept           {}
    → ApiResponse<{ card, integration }>
    → card_accepted arrives via WS

POST /api/queen-bee/:pid/cards/:cardId/request-changes  { guidance }
    → card_changes_requested arrives via WS

POST /api/queen-bee/:pid/cards/:cardId/restart-review   {}
    → card_review_complete arrives via WS

POST /api/queen-bee/:pid/cards/:cardId/remediate        { action, suggestionId }
    → ApiResponse<{ kind: "proposal"; proposal } | { kind: "feedback"; feedback } | { kind: "redevise"; card; question }>
```

### Ideas

```
POST /api/queen-bee/:pid/ideas               { title, brief }
    → ApiResponse<Idea>

POST /api/queen-bee/:pid/ideas/:iid/archive   {}
    → ideas_changed arrives via WS
```

### Integration

```
GET  /api/queen-bee/:pid/integration          → ProjectIntegrationStatus
POST /api/queen-bee/:pid/integration/integrate {}
    → ApiResponse<ProjectIntegrationStatus>
    → integration_changed arrives via WS
```

### Projects

```
POST   /api/queen-bee/projects               { path, name? } → ApiResponse<ProjectListItem>
PATCH  /api/queen-bee/projects/:pid/config    { maxConcurrentWorkers } → ProjectListItem
DELETE /api/queen-bee/projects/:pid
```

### Activity & Review Readiness

```
GET /api/queen-bee/:pid/cards/:cardId/activity           → CardActivityEvent[]
GET /api/queen-bee/:pid/cards/:cardId/review-readiness   → ReviewReadiness
GET /api/queen-bee/:pid/requirements                     → { content }
```

---

## 4. Types

Everything a new UI imports lives in `shared/` — the types are the contract, no server source needed:

```typescript
// WS contract: 14 discriminated event types, one union
import type { QueenBeeEvent } from "shared/queen-bee-events";

// REST response wrapper
import type { ApiResponse } from "shared/queen-bee-api";

// Domain types
import type {
  Board, Card, CardSpecification, Column, Idea,
  PlanningProposal, PlanningChange, PlanningOutcome,
  RequirementsFeedback, RequirementsSessionKind,
  ReviewReadiness, ReviewerLog, WorkerAdmission,
  WorkerHandover, WorkerLog, WorkAttempt,
  CoordinatorLog, CoordinatorSuggestion,
} from "shared/board-types";

import type { ProjectIntegrationStatus, ProjectListItem } from "shared/project-types";

// Runtime validators
import {
  isRecord, isWorkerAdmission, isReviewReadiness,
  isPlanningProposal, isRequirementsFeedback,
  isPlanningChange, isPlanningRunKind,
  COLUMN_LABELS,
} from "shared/board-types";
```

---

## 5. Component Breakdown

Each view maps to a phase or card state.

| Component | Renders when | Key data sources |
|---|---|---|
| Project list | No project selected | `GET /projects`, `projects_changed` WS |
| DeviseChat | `phase === "requirements"` or `phase === "no_requirements"` | Phase response (`session.messages`), `draft_updated` WS |
| Planning proposal | `phase === "planning"` | Phase response (`outcome.proposal` / `outcome.feedback`) |
| Board | `phase === "board"` | `GET /board` (initial), `board_snapshot` WS, card-level WS events |
| Card detail | Card selected | `GET /cards/:id/activity`, `reviewReadiness`, `card_worker_progress` WS |
| Unfulfillable panel | Card in unfulfillable column | `card_unfulfillable` WS (`handover`, `coordinatorLog`) |
| Integration bar | Always on project page | `GET /integration`, `integration_changed` WS |

The board requires the most state. Start with `GET /board` on mount, then fold `board_snapshot` events on each WS message. Card-level events (`card_moved`, `card_accepted`) let you optimistically update without a full snapshot.

---

## 6. State Machine

```
                 +-------+
        .------->| Phase |<-------.
        |        +-------+        |
        |                          |
   [boot: GET /phase]     [WS: planning_outcome]
        |                          |
        v                          |
  +------------+         +---------+-------+
  | no_requirements | ---> |   requirements      |
  +----------------+       +---------+-----------+
                                     |
                              [user approves draft]
                                     |
                                     v
                           +---------+-----------+
                           |     planning        |
                           +---------+-----------+
                                     |
                        [user accepts / apply]
                                     |
                                     v
                           +---------+-----------+
                           |       board         |
                           +---------------------+
```

Transitions are initiated by the user (POST commands) and confirmed by WS events.
