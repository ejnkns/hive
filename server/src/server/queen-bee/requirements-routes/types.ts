/** @private — route handler dependency types */

import type { BoardStore } from "../board-store";
import type { ProjectStore } from "../create-project-store";
import type { PlanningManager } from "../planner";
import type { RequirementsSessionManager } from "../requirements-session";

export type RouteDeps = {
  sessionManager: RequirementsSessionManager;
  projectStore: ProjectStore;
  boardStore: BoardStore;
  planningManager: PlanningManager;
};
