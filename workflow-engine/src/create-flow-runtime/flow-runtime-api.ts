/** @private — only imported by create-flow-runtime.ts */

import type { WorkflowInstanceControllerAPI } from "../create-workflow-instance-controller";
import type { RuntimeWorkflowInstanceState } from "../shared/workflow-instance-state";
import type { FlowEventHandler, FlowRuntimeEvent } from "./flow-runtime-events";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "./response-types";

// The public API of one flow runtime: config/state access, instance creation
// and dispatch, event subscription, and the serialized read shapes.
export type FlowRuntimeAPI<TFlowConfig, TFlowState> = {
  getFlowConfig(): TFlowConfig;
  getFlowState(): TFlowState;
  patchFlowConfig(patch: Partial<TFlowConfig>): void;
  patchFlowState(patch: Partial<TFlowState>): void;
  addWorkflowInstance(
    workflowId: string,
    instanceState?: Partial<RuntimeWorkflowInstanceState>,
    // When restoring a persisted instance, reuse its original id so the
    // persistence layer overwrites the same file instead of orphaning a new
    // one per restart (which compounded into unbounded instance growth).
    restoreId?: string
  ): WorkflowInstanceControllerAPI;
  getWorkflowInstance(
    instanceId: string
  ): WorkflowInstanceControllerAPI | undefined;
  workflowInstances: RuntimeWorkflowInstanceState[];
  // Gate-context projection: each workflow instance's id + current state,
  // filterable by state. Gates reference instances by id (dependsOn checks),
  // so this carries the id the raw states omit.
  workflowInstancesInState(
    stateId?: string
  ): { currentState: string; id: string }[];
  on(handler: FlowEventHandler): () => void;
  getWorkflowDefinitions(): WorkflowDefResponse[];
  getWorkflowInstanceEntries(): WorkflowInstanceEntry[];
};
