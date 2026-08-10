import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { CustomRenderKind } from "workflow-engine/workflow-types";

// The stable, versioned contract every workflow-instance component implements.
// A flow-declared custom instance component (WorkflowConfig.ui.instanceComponent)
// receives exactly these props; the default WorkflowInstanceCard and the
// component registry both honor it, so custom components share the interface.
export type InstanceComponentProps = {
  workflowDef: WorkflowDefResponse;
  instanceEntry: WorkflowInstanceEntry;
  customKinds: readonly CustomRenderKind[];
  onAction(actionId: string, payload?: Record<string, unknown>): void;
  onSendMessage(content: string): Promise<void>;
  // Optional: invoked with the collected values of the workflow's editFields
  // when the user submits the "Edit details" form. Absent on custom
  // components that predate the instance-edit surface — they simply render no
  // edit affordance (or handle it themselves).
  onPatchState?(values: Record<string, unknown>): void;
};
