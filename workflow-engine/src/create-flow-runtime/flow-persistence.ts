/** @private — only imported by create-flow-runtime.ts */

import type { RuntimeWorkflowInstanceState } from "../shared/workflow-instance-state";

// The write-only persistence contract the flow runtime calls to persist
// operational state. Implemented by the server's filesystem store; the
// runtime never touches the store directly and never reads — recovery
// (loadFlow/loadAllFlows) and deletion (deleteFlow) are server concerns on
// the store's own type, not the runtime's. Running-task context persists
// inside saveInstance's state (the instance state carries it), so there is no
// separate context write.
export type FlowPersistence = {
  saveFlow(flowId: string, config: unknown, state: unknown): void;
  saveInstance(
    flowId: string,
    instanceId: string,
    workflowId: string,
    state: RuntimeWorkflowInstanceState
  ): void;
};
