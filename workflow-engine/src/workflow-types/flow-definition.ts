/** @private — the flow definition: the single pure-data artifact an agent
 * writes, a UI builder edits, and the engine compiles to the runtime
 * projection at registration (compile-flow-definition.ts). This is the repo's
 * FlowDefinition: the authoring surface, extended with the vocabulary
 * (instanceState data, structured gates/values,
 * patch/completionOutput/extract task fields, task render hints, ui
 * kinds/view).
 *
 * The runtime contract the engine executes is `CompiledFlowDefinition` — the
 * same definition after compilation (closures for gates/transforms, ops/tools
 * by name). The runners, UI, and engine internals consume the compiled
 * projection and never see the data form; the compile step is the seam the
 * migration moved, not the runtime seam. */

import type { OperationFn } from "../runners/create-operation-runner.ts";
import type { Tool } from "../runners/tool-types.ts";
import type { ActionVariant, WorkflowView } from "./actions.ts";
import type { ConfigField } from "./config-field.ts";
import type { RuntimeGateContext, TaskOutputMap } from "./core.ts";
import type {
  DefinitionError,
  DefinitionValidationContext,
  EdgeSpec,
  FlowLevelActionSpec,
  FlowStateField,
  OperationRefSpec,
  ToolRefSpec,
  WorkflowSpec,
} from "./definition-vocabulary.ts";
import type { CustomRenderKind } from "./render-hints.ts";
import type { RuntimeWorkflowConfig } from "./state-config.ts";

// === FLOW THEME (the generic surface's declarative theming tokens) ===

// Declarative theming for the generic flow surfaces (the flows-list card and
// every flow page). Pure data, whitelisted, and generic: the renderer consumes
// the tokens — it never special-cases a flow by name. Contrast is the
// renderer's job (one accent → tint/text/ring via color-mix); authors never
// manage color pairs or palettes.
export type FlowThemeSpec = {
  // One #rrggbb hex value. The renderer derives --flow-accent /
  // --flow-accent-rgb / --flow-on-accent from it (both themes fall out of the
  // mixes against the active theme's surfaces).
  accent?: string;
  // A single character rendered as a small badge beside the definition name
  // (flows list + definition-page header). Emoji are rejected at parse time —
  // they are multi-codepoint, and the UI keeps a no-emoji rule.
  emblem?: string;
};

// === FLOW DEFINITION (the pure-data authoring artifact) ===

// The complete description of one flow type, as data: its workflows, the
// edges between them, and the capabilities its tasks call by name — custom
// tools and operations are REFS to referenced modules (`./tools/x.ts`), the
// loader imports them and passes a resolveRef to the compiler. Gates are
// structured predicates, values are a small set of sources, patches and
// completion contracts are declared data. Nothing here is a closure — a
// visual editor serializes and round-trips this shape as-is, and arbitrary
// logic always lives in a referenced module (the builder boundary).
export type FlowDefinition = {
  id: string;
  label: string;
  description?: string;
  configSchema?: ConfigField[];
  // Flow-level state declaration (E2): the fields the flow's cross-entity
  // state may carry. FlowState writes — operations' patchFlowState calls and
  // toFlowState edge transforms — are validated against these fields like
  // instance writes are validated against instanceState.
  flowState?: FlowStateField[];
  // Directory under basePath that holds this instance's persisted domain
  // state; defaults to .<definition-id>.
  domainDir?: string;
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
    // A flow-level layout hint (the surface may fall back).
    view?: WorkflowView;
    // Declarative theming tokens for the generic flow surfaces (flows-list
    // card + flow pages). Pure data — rides through the compile step unchanged.
    theme?: FlowThemeSpec;
  };
  // Custom tools and operations referenced as files; tasks reference them by
  // id/name alongside the engine's infrastructure capabilities.
  tools?: ToolRefSpec[];
  operations?: OperationRefSpec[];
  // External packages the referenced files may import. Imports are restricted
  // to engine primitives, the flow's own files, node: builtins, and exactly
  // these declared packages — anything else fails the module-set gate with a
  // readable finding.
  dependencies?: string[];
  workflows: WorkflowSpec[];
  edges?: EdgeSpec[];
  // Project-level actions rendered on the instance header.
  actions?: FlowLevelActionSpec[];
};

// === THE COMPILED PROJECTION (the runtime contract) ===

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

// The contract a definition-referenced edge transform implements: the source
// workflow's task outcomes → target instance state (or an array for fan-out).
// The module-set lint checks the referenced export against this.
export type TransformContract = NonNullable<FlowEdge["transform"]>;

// A compiled project-level action rendered on the instance header.
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

// The runtime projection compileFlowDefinition produces: the data definition
// with every gate/transform compiled to closures and the capability refs
// resolved to their tool/op objects. The runners, UI, and engine internals
// consume exactly this shape. A definition is either static (its workflows
// listed directly) or a factory (buildWorkflows resolves flow config into
// workflow configs) — the compiled projection carries the same alternatives,
// but the data form is always static (a factory is a runtime concern).
export type CompiledFlowDefinition = {
  id: string;
  label: string;
  description?: string;
  configSchema?: ConfigField[];
  // The declared flowState fields (E2), carried on the compiled projection so
  // the server can resolve flowState-driven surfaces (e.g. edit-field options
  // from flowState) and the gate can validate patchFlowState writes.
  flowState?: FlowStateField[];
  edges: RuntimeFlowEdge[];
  tools?: readonly Tool[];
  operations?: Record<string, OperationFn>;
  // Directory under basePath that holds this instance's persisted domain
  // state; defaults to .<definition-id>.
  domainDir?: string;
  // Project-level actions rendered on the instance header.
  actions?: FlowLevelAction[];
  // Flow-level rendering declarations. Pure data (passes through the compile
  // step unchanged).
  ui?: {
    kinds?: CustomRenderKind[];
    components?: Record<string, string>;
    view?: WorkflowView;
    theme?: FlowThemeSpec;
  };
} & (
  | { workflows: RuntimeWorkflowConfig[] }
  | {
      buildWorkflows: (
        config: Record<string, unknown>
      ) => RuntimeWorkflowConfig[];
    }
);

export type { DefinitionError, DefinitionValidationContext };
