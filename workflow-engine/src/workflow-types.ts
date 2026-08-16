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

export type { ChatMessage } from "./shared/chat-message.ts";
export type {
  TaskRunnerContext,
  WorkflowInstanceProjection,
  WorkflowInstancesInState,
} from "./task-runner.ts";
export type {
  ActionVariant,
  AutoTransition,
  BoardColumn,
  ManualAction,
  StateCategory,
  VisibleAction,
  WorkflowView,
} from "./workflow-types/actions.ts";
export type {
  ConfigField,
  ConfigFieldType,
} from "./workflow-types/config-field.ts";
export type {
  GateContext,
  GateContract,
  ModelCallStatus,
  NoOutput,
  RunningTaskContext,
  RuntimeGateContext,
  TaskOutcome,
  TaskOutputMap,
} from "./workflow-types/core.ts";
export type {
  ActionSpec,
  AutoTransitionSpec,
  CompletionContract,
  CompletionOutputField,
  CrossInstanceWriteDecl,
  DefinitionError,
  DefinitionValidationContext,
  DisplayFieldRender,
  DisplayFieldSpec,
  EdgeSpec,
  EdgeTransformRefSpec,
  ExtractRefSpec,
  FanOutValueSpec,
  FieldType,
  FlowLevelActionSpec,
  FlowStateField,
  GateSpec,
  InstanceStateField,
  ModuleRefKind,
  OperationRefSpec,
  StateSpec,
  TaskSpec,
  ToolRefSpec,
  ValueSpec,
  WorkflowSpec,
} from "./workflow-types/definition-vocabulary.ts";
export type {
  DerivedDisplay,
  DisplayField,
  DisplayHint,
  WorkflowSummary,
} from "./workflow-types/display.ts";
export type {
  ExtractContext,
  OutputExtractor,
} from "./workflow-types/extractor.ts";
export type {
  CompiledFlowDefinition,
  FlowDefinition,
  FlowEdge,
  FlowLevelAction,
  FlowThemeSpec,
  RuntimeFlowEdge,
  ServedComponentSpec,
  TransformContract,
} from "./workflow-types/flow-definition.ts";
export type {
  StateTransitionEntry,
  TaskExecutionEntry,
  WorkflowHistoryEntry,
} from "./workflow-types/history.ts";
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
} from "./workflow-types/render-hints.ts";
export { builtinRenderContracts } from "./workflow-types/render-hints.ts";
export type {
  ElementConstructor,
  FlowComponentDeps,
  FlowComponentModule,
  FlowComponentRegistrations,
  InstanceComponentProps,
  WorkflowViewProps,
} from "./workflow-types/served-components.ts";
export type {
  RuntimeStateDef,
  RuntimeWorkflowConfig,
  StateDef,
  StateTaskDef,
  WorkflowConfig,
} from "./workflow-types/state-config.ts";
export { defineWorkflow } from "./workflow-types/state-config.ts";
