/** @public — WebSocket event contract for queen-bee. Import from here, not from server internals. */

import type {
  Board,
  Card,
  Column,
  Idea,
  PlanningOutcome,
  WorkerHandover,
} from "./board-types";
import type { ProjectIntegrationStatus } from "./project-types";

export type QueenBeeEvent =
  | CardMoved
  | CardWorkerProgress
  | CardReviewComplete
  | CardAccepted
  | CardChangesRequested
  | CardUnfulfillable
  | CardsCreated
  | IdeasChanged
  | DraftUpdated
  | DraftFinalized
  | PlanningOutcomeEvent
  | IntegrationChanged
  | BoardSnapshot
  | ProjectsChanged;

type CardMoved = {
  type: "card_moved";
  version: number;
  cardId: string;
  column: Column;
};

type CardWorkerProgress = {
  type: "card_worker_progress";
  version: number;
  cardId: string;
  iteration: number;
  toolCalls: Array<{ name: string; args: string }>;
  content?: string;
};

type CardReviewComplete = {
  type: "card_review_complete";
  version: number;
  cardId: string;
  verdict: "approved" | "changes_requested";
};

type CardAccepted = {
  type: "card_accepted";
  version: number;
  cardId: string;
};

type CardChangesRequested = {
  type: "card_changes_requested";
  version: number;
  cardId: string;
};

type CardUnfulfillable = {
  type: "card_unfulfillable";
  version: number;
  cardId: string;
  handover: WorkerHandover;
};

type CardsCreated = {
  type: "cards_created";
  version: number;
  cardIds: string[];
};

type IdeasChanged = {
  type: "ideas_changed";
  version: number;
  ideas: Idea[];
};

type DraftUpdated = {
  type: "draft_updated";
  version: number;
  scope: "project" | "card" | "idea";
  scopeId?: string;
  content: string;
};

type DraftFinalized = {
  type: "draft_finalized";
  version: number;
  scope: "project" | "card" | "idea";
  scopeId?: string;
  content: string;
};

type PlanningOutcomeEvent = {
  type: "planning_outcome";
  version: number;
  outcome: PlanningOutcome;
};

type IntegrationChanged = {
  type: "integration_changed";
  version: number;
  status: ProjectIntegrationStatus;
};

type BoardSnapshot = {
  type: "board_snapshot";
  version: number;
  board: Board;
};

type ProjectsChanged = {
  type: "projects_changed";
  version: number;
};
