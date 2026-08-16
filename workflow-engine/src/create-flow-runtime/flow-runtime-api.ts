/** @private — only imported by create-flow-runtime.ts */

import type { WorkflowInstanceControllerAPI } from "../create-workflow-instance-controller.ts";
import type { RuntimeWorkflowInstanceState } from "../shared/workflow-instance-state.ts";
import type { WorkflowInstancesInState } from "../task-runner.ts";
import type { FlowEventHandler } from "./flow-runtime-events.ts";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "./response-types.ts";

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
  // Removes a workflow instance from the flow (E5): the controller is
  // dropped, its persisted state is deleted, an instance_removed event is
  // emitted, and title-based references to it go stale gracefully (callers
  // treat a missing id as an unmet/unknown reference, never an error).
  // Returns false for an unknown instance id.
  removeWorkflowInstance(instanceId: string): boolean;
  // Gate-context projection: each workflow instance's id, workflow, and
  // current state, filterable by state (legacy) or by a
  // { workflowId?, stateId? } filter. Gates reference instances by id
  // (dependsOn checks), so this carries the id the raw states omit.
  workflowInstancesInState: WorkflowInstancesInState;
  on(handler: FlowEventHandler): () => void;
  getWorkflowDefinitions(): WorkflowDefResponse[];
  getWorkflowInstanceEntries(): WorkflowInstanceEntry[];
};
