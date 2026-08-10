/** @public — the engine's workflow type contract: everything a flow author
 * imports from "workflow-engine/workflow-types". Import from here, not from
 * workflow-types/ directly.
 *
 * The vocabulary is grouped by theme in workflow-types/: core outcomes and
 * gate context (core), the action/state vocabulary (actions), render hints
 * (render-hints), derived displays and the workflow summary (display),
 * ConfigField (config-field), the workflow configuration and defineWorkflow
 * (state-config), the flow definition (flow-definition), and instance history
 * entries (history). */

export type { ChatMessage } from "./shared/chat-message";
export type {
  ActionVariant,
  AutoTransition,
  BoardColumn,
  ManualAction,
  StateCategory,
  VisibleAction,
  WorkflowView,
} from "./workflow-types/actions";
export type {
  ConfigField,
  ConfigFieldType,
} from "./workflow-types/config-field";
export type {
  GateContext,
  ModelCallStatus,
  NoOutput,
  RunningTaskContext,
  RuntimeGateContext,
  TaskOutcome,
  TaskOutputMap,
} from "./workflow-types/core";
export type {
  DerivedDisplay,
  DisplayField,
  DisplayHint,
  WorkflowSummary,
} from "./workflow-types/display";
export type {
  FlowDefinition,
  FlowEdge,
  FlowLevelAction,
  RuntimeFlowEdge,
} from "./workflow-types/flow-definition";
export type {
  StateTransitionEntry,
  TaskExecutionEntry,
  WorkflowHistoryEntry,
} from "./workflow-types/history";
export type {
  BuiltinRenderHint,
  BuiltinRenderKind,
  CustomRenderKind,
  PropPath,
  RenderContract,
  RenderContractProp,
  RenderHint,
  RenderKind,
  RenderPropScope,
  RenderPropType,
  RuntimeRenderHint,
} from "./workflow-types/render-hints";
export { builtinRenderContracts } from "./workflow-types/render-hints";
export type {
  RuntimeStateDef,
  RuntimeWorkflowConfig,
  StateDef,
  StateTaskDef,
  WorkflowConfig,
} from "./workflow-types/state-config";
export { defineWorkflow } from "./workflow-types/state-config";
