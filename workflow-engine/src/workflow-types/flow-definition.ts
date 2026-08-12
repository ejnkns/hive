/** @private — the flow definition types: edges, config fields, flow-level
 * actions, and FlowDefinition. */

import type { OperationFn } from "../runners/create-operation-runner.ts";
import type { Tool } from "../runners/tool-types.ts";
import type { ActionVariant } from "./actions.ts";
import type { ConfigField } from "./config-field.ts";
import type { RuntimeGateContext, TaskOutputMap } from "./core.ts";
import type { CustomRenderKind } from "./render-hints.ts";
import type { RuntimeWorkflowConfig } from "./state-config.ts";

// === FLOW DEFINITION ===

// Edge between workflows. The transform receives the source workflow's
// task outputs and produces context for the target workflow. It returns either
// one instance-state object or an array of them — an array creates one target
// workflow instance per element (fan-out, e.g. one cards instance per planned
// card). The returned object is checked against the target workflow's state
// type (TTargetState) so misspellings and undeclared fields fail to compile.
// When toFlowState is true, the transformed output updates FlowState instead
// of creating new instances. Omit or set toWorkflow for instance creation.
export type FlowEdge<
  TSourceOutputs extends Record<string, unknown> = Record<string, unknown>,
  TTargetState extends Record<string, unknown> = Record<string, unknown>,
> = {
  fromWorkflow: string;
  fromStates: string[];
  toWorkflow?: string;
  toFlowState?: boolean;
  transform?: (
    source: Partial<TaskOutputMap<TSourceOutputs>>
  ) => Partial<TTargetState> | Partial<TTargetState>[];
};

export type RuntimeFlowEdge = FlowEdge;

// The contract a blueprint-referenced edge transform implements: the source
// workflow's task outcomes → target instance state (or an array for fan-out).
// The renderer emits stubs typed with this and the module-set lint checks the
// referenced export against it.
export type TransformContract = NonNullable<FlowEdge["transform"]>;

// The value/input type of a ConfigField. `type` drives both validation and
// rendering (the existing code conflates value type with presentation — e.g.
// "string" + options renders a single select). Canonical stored formats:
//   "date"     → "YYYY-MM-DD" (what <input type="date"> emits)
//   "datetime" → "YYYY-MM-DDTHH:mm" (what <input type="datetime-local"> emits)
//   "string[]" → array of strings; with `options` a multi-select (every chosen
//                 value must be in `options`), without a free-form tag list
// The canonical formats are validated server-side (collectConfigFieldValues)
// and by the UI renderers, so stored values never drift.
// dispatch a state-level action to every eligible instance of a workflow.
export type FlowLevelAction = {
  id: string;
  label: string;
  variant?: ActionVariant;
  gate?: (ctx: RuntimeGateContext) => boolean;
  // Creates a new instance of the workflow; fields render as a form and the
  // collected values become the new instance's workflowInstanceState.
  createInstance?: { workflowId: string; fields?: ConfigField[] };
  // Dispatches the referenced state-level action to every instance of the
  // workflow where that action is available (per-instance gates respected).
  dispatchToAll?: { workflowId: string; actionId: string };
};

// A FlowDefinition is the complete description of one flow type: its
// workflows, the edges between them, and the capabilities its tasks call by
// name — self-contained domain tools (schema + executor) and deterministic
// domain operations. Infrastructure tools and operations are not listed here —
// the engine ships them to every flow. Capabilities are resolved by name
// against the merged registry (engine infrastructure + this list) at runtime.
//
// A definition is either static (its workflows listed directly) or a factory
// (buildWorkflows resolves flow config into workflow configs). Static
// definitions ARE the layout; a factory exists for presets whose workflow
// definitions depend on flow config (e.g. a concurrency limit or a system
// prompt override). The engine executes the resolved result either way.
export type FlowDefinition = {
  id: string;
  label: string;
  description?: string;
  configSchema?: ConfigField[];
  edges: FlowEdge[];
  tools?: readonly Tool[];
  operations?: Record<string, OperationFn>;
  // Directory under basePath that holds this instance's persisted domain
  // state; defaults to .<definition-id>.
  domainDir?: string;
  // Project-level actions rendered on the instance header.
  actions?: FlowLevelAction[];
  // Flow-level rendering declarations. Pure data.
  ui?: {
    // Custom render kinds the definition's tasks may reference; the rendering
    // surface validates resolved props against each contract and falls back to
    // json on mismatch.
    kinds?: CustomRenderKind[];
    // Served-at-runtime component modules: component id → TypeScript module
    // source (erasable syntax). Each module default-exports a factory that
    // receives the app's lit runtime and returns the component/kinds it
    // registers. Opaque to the engine — the server transpiles and serves it;
    // the rendering surface fetches, evaluates, and registers the result.
    components?: Record<string, string>;
  };
} & (
  | { workflows: RuntimeWorkflowConfig[] }
  | {
      buildWorkflows: (
        config: Record<string, unknown>
      ) => RuntimeWorkflowConfig[];
    }
);
