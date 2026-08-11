/** @private — only imported by create-flow-runtime.ts */

import type { RuntimeWorkflowInstanceState } from "../shared/workflow-instance-state.ts";

// Flow-level events emitted by the runtime as instances change and edges fire.
export type FlowRuntimeEvent =
  | { type: "flow_state_changed"; state: Record<string, unknown> }
  | { type: "instance_created"; instanceId: string; workflowId: string }
  | {
      type: "instance_state_changed";
      instanceId: string;
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
    }
  | {
      type: "instance_terminated";
      instanceId: string;
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
    };

export type FlowEventHandler = (event: FlowRuntimeEvent) => void;
