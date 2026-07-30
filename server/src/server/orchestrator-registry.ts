/** @public — per-card workflow instance registry */

import {
  createWorkflowInstanceController,
  type WorkflowInstanceControllerAPI,
} from "workflow-engine/create-workflow-instance-controller";
import type {
  CardsItemState,
  CardsStateId,
  CardsTaskOutputs,
} from "../../../queen-bee/cards-workflow";
import { cardsWorkflow } from "../../../queen-bee/cards-workflow";
import { createEngineRunners } from "./engine-bridge";

const runners = createEngineRunners();
const instances = new Map<
  string,
  WorkflowInstanceControllerAPI<CardsTaskOutputs, CardsStateId, CardsItemState>
>();

function key(projectId: string, cardId: string): string {
  return `${projectId}\0${cardId}`;
}

export function getOrCreateOrchestrator(
  projectId: string,
  cardId: string,
  repoPath: string
): WorkflowInstanceControllerAPI<
  CardsTaskOutputs,
  CardsStateId,
  CardsItemState
> {
  const k = key(projectId, cardId);
  let orch = instances.get(k);
  if (orch) return orch;

  orch = createWorkflowInstanceController(
    cardsWorkflow,
    {
      operation: runners.operationRunner,
      "ai-task": runners.aiTaskRunner,
      "ai-chat": runners.aiChatRunner,
    },
    {
      currentState: "ready",
      taskOutputs: {},
      hasRunningTask: false,
      runningTaskId: null,
      runningTaskContext: null,
      workflowInstanceState: {
        projectId,
        repoPath,
        attempt: 0,
        validationFailures: 0,
      },
      history: [],
    }
  );

  instances.set(k, orch);
  return orch;
}

export function getOrchestrator(
  projectId: string,
  cardId: string
):
  | WorkflowInstanceControllerAPI<
      CardsTaskOutputs,
      CardsStateId,
      CardsItemState
    >
  | undefined {
  return instances.get(key(projectId, cardId));
}

export function runningCardIds(projectId: string): string[] {
  const result: string[] = [];
  for (const [k, orch] of instances) {
    if (k.startsWith(`${projectId}\0`) && orch.getState().hasRunningTask) {
      result.push(k.slice(projectId.length + 1));
    }
  }
  return result;
}
