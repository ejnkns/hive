/** The served-component contract: the types a definition's component module
 * (FlowDefinition.ui.components) and the rendering surface share. Components
 * are authored as standalone erasable-syntax modules that default-export a
 * factory receiving the app's lit runtime and returning the elements to
 * register. These types live in the engine so preset/definition component
 * files can type their modules with a type-only import from the allowlist
 * (workflow-engine/workflow-types) — the module-set gate typechecks them. */

import type { css, html, LitElement, nothing, svg } from "lit";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "../create-flow-runtime.ts";
import type { ActionVariant } from "./actions.ts";
import type { ConfigField } from "./config-field.ts";
import type { CustomRenderKind } from "./render-hints.ts";

// The class contract a served element must satisfy: a parameterless
// constructor producing an HTMLElement (custom elements are constructed via
// `new`, never parsed from HTML).
export type ElementConstructor = new () => HTMLElement;

// The lit runtime handed to a served component factory. A served module is
// evaluated as a standalone blob module (no imports), so the factory receives
// everything it needs to build Lit custom elements.
export type FlowComponentDeps = {
  LitElement: typeof LitElement;
  html: typeof html;
  css: typeof css;
  nothing: typeof nothing;
  // The svg template tag: renders SVG-namespace elements (the html tag cannot
  // — SVG is a distinct XML namespace, so its elements must be created with
  // createElementNS). The map view uses it for the semantic backdrop.
  svg: typeof svg;
};

// The registrations a served component module returns: instance components
// (resolved by WorkflowConfig.ui.instanceComponent) and kind renderers
// (resolved by custom render hints).
export type FlowComponentRegistrations = {
  components?: Record<string, ElementConstructor>;
  kinds?: Record<string, ElementConstructor>;
};

// The served module's contract: a default-export factory.
export type FlowComponentModule = {
  default?: (deps: FlowComponentDeps) => FlowComponentRegistrations;
};

// The stable, versioned props contract every workflow-instance component
// implements. A flow-declared custom instance component
// (WorkflowConfig.ui.instanceComponent) receives exactly these props; the
// default card and the component registry both honor it, so custom components
// share the interface.
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

// The props contract a workflow-level custom view implements
// (WorkflowConfig.ui.workflowComponent): a component rendering a workflow's
// ENTIRE workflow-instances section (replacing the generic grouped board/list
// content — the section header and the flow-instance page furniture stay
// standard). The view may compose the canonical board under custom chrome via
// the <workflow-board-content> element.
export type WorkflowViewProps = {
  workflowDef: WorkflowDefResponse;
  // Full workflow-instance state: fields, task outputs (incl. chat
  // transcripts), availableActions, workflowSummary counts.
  entries: WorkflowInstanceEntry[];
  customKinds: readonly CustomRenderKind[];
  // Cross-workflow context: every workflow of the flow with its instance
  // count by current state — so a workflow-level view can render
  // sibling-workflow state (e.g. the expedition map shows the ticket
  // frontier/fog/decisions). Includes the view's own workflow.
  workflowCounts: ReadonlyArray<{
    workflowId: string;
    label: string;
    total: number;
    byState: Readonly<Record<string, number>>;
  }>;
  // The existing hive-action / hive-send-message callbacks, scoped to a
  // workflow instance id.
  onAction(
    workflowInstanceId: string,
    actionId: string,
    payload?: Record<string, unknown>
  ): void;
  onSendMessage(workflowInstanceId: string, content: string): Promise<void>;
  // NEW hive-select: the shell routes to the workflow-instance page.
  onSelect(workflowInstanceId: string): void;
};

// The flow-level status projected into the payload (error > running > waiting
// > complete > idle, computed by the server's instance-status).
export type FlowStatus = "error" | "running" | "waiting" | "idle" | "complete";

// The trimmed flow projection a flow-level component receives: identity,
// status, and config — not the whole FlowResponse (no ui, no definitionSource,
// no delete surface).
export type FlowViewFlow = {
  id: string;
  label: string;
  status: FlowStatus;
  config: Record<string, unknown>;
};

// The gate-evaluated, UI-facing view of a flow-level action (no gate function
// — the payload carries only what the page body's buttons need).
export type FlowActionView = {
  id: string;
  label: string;
  variant: ActionVariant;
  createInstance?: { workflowId: string; fields: ConfigField[] };
  dispatchToAll?: { workflowId: string; actionId: string };
};

// The props contract a flow-level custom component implements
// (FlowDefinition.ui.flowComponent): a component rendering the WHOLE
// flow-instance page body (replacing the default actions bar + overview +
// per-workflow sections). Delete/status/breadcrumb stay shell-side and are
// NOT exposed here — a served module cannot hide them.
export type FlowViewProps = {
  flow: FlowViewFlow;
  workflowDefs: WorkflowDefResponse[];
  entries: WorkflowInstanceEntry[];
  customKinds: readonly CustomRenderKind[];
  workflowCounts: WorkflowViewProps["workflowCounts"];
  availableFlowActions: readonly FlowActionView[];
  persistedOutputs: Readonly<Record<string, string>>;
  persistedOutputDirs: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  onAction(
    workflowInstanceId: string,
    actionId: string,
    payload?: Record<string, unknown>
  ): void;
  onSendMessage(workflowInstanceId: string, content: string): Promise<void>;
  onPatchState(
    workflowInstanceId: string,
    values: Record<string, unknown>
  ): void;
  onSelect(workflowInstanceId: string): void;
  onFlowAction(actionId: string): void;
  onCreate(actionId: string): void;
};
