/** @private — only imported by create-flow-runtime.ts */

import type { RuntimeWorkflowInstanceState } from "../shared/workflow-instance-state.ts";

// The write-only persistence contract the flow runtime calls to persist
// operational state. Implemented by the server's filesystem store; the
// runtime never touches the store directly and never reads — recovery
// (loadFlow/loadAllFlows) and deletion (deleteFlow/deleteInstance) are server
// concerns on the store's own type, not the runtime's. Running-task context
// persists inside saveInstance's state (the instance state carries it), so
// there is no separate context write.
export type FlowPersistence = {
  saveFlow(flowId: string, config: unknown, state: unknown): void;
  saveInstance(
    flowId: string,
    instanceId: string,
    workflowId: string,
    state: RuntimeWorkflowInstanceState
  ): void;
  // E5: removes a workflow instance's persisted state. The runtime calls it
  // when an instance is deleted so a removed instance does not resurrect on
  // the next boot.
  deleteInstance?(flowId: string, instanceId: string): void;
};
