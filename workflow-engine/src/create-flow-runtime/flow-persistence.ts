/** @private — only imported by create-flow-runtime.ts */

import type { RuntimeWorkflowInstanceState } from "../shared/workflow-instance-state";

// The persistence contract the flow runtime calls to save/restore operational
// state. Implemented by the server's filesystem store; the runtime never
// touches the store directly.
export type FlowPersistence = {
  saveFlow(flowId: string, config: unknown, state: unknown): void;
  saveInstance(
    flowId: string,
    instanceId: string,
    workflowId: string,
    state: RuntimeWorkflowInstanceState
  ): void;
  saveRunningTaskContext(
    flowId: string,
    instanceId: string,
    context: unknown
  ): void;
  deleteFlow(flowId: string): void;
  loadFlow(flowId: string): {
    config: unknown;
    state: unknown;
    instances: Array<{
      instanceId: string;
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
    }>;
  } | null;
  loadAllFlows(): Array<{
    flowId: string;
    config: unknown;
    state: unknown;
    instances: Array<{
      instanceId: string;
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
    }>;
  }>;
};
