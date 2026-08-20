// The render-hint vocabulary: built-in kinds and contracts, prop paths, and
// custom kinds. Internal to workflow-types/ — import through workflow-types.ts.

// --- Render hints ---
//
// A small optional vocabulary a workflow definition uses to self-describe how
// its data renders in the generic flow UI. Hints are pure data — JSON
// serializable, never functions — so they cross the server wire unchanged. The
// rendering surface resolves each hint against a kind's input contract and
// falls back to raw rendering when a hint is absent or its contract mismatches.
//
// `kind` is a type-shape discriminator (what shape the component consumes), not
// a presentation pick. Built-in kinds ship with the engine; a flow definition
// may declare custom kinds and their input contracts (FlowDefinition.ui.kinds).
// The `kind` field stays open so custom kinds can register later without a
// schema change.

export type BuiltinRenderKind =
  | "markdown"
  | "text"
  | "card"
  | "cards"
  | "chips"
  | "json";
export type RenderKind = BuiltinRenderKind | (string & {});

// The value types a render contract's props may declare. The runtime validates
// resolved prop values against these; "unknown" accepts anything.
export type RenderPropType =
  | "string"
  | "string[]"
  | "array"
  | "boolean"
  | "number"
  | "unknown";

// Where a contract prop resolves its value from.
//   output:  against the task output / display field value
//   element: against each item of the kind's array input (the output-scoped
//            prop declared with type "array")
export type RenderPropScope = "output" | "element";

export type RenderContractProp = {
  name: string;
  type: RenderPropType;
  scope: RenderPropScope;
};

export type RenderContract = {
  props: readonly RenderContractProp[];
};

// The built-in kind contracts, shipped to the UI for runtime validation. A
// custom kind declares the same shape in the flow definition
// (FlowDefinition.ui.kinds).
export const builtinRenderContracts = {
  markdown: {
    props: [{ name: "content", type: "string", scope: "output" }],
  },
  text: {
    props: [{ name: "content", type: "string", scope: "output" }],
  },
  card: {
    props: [
      { name: "title", type: "string", scope: "output" },
      { name: "description", type: "string", scope: "output" },
      { name: "bullets", type: "string[]", scope: "output" },
    ],
  },
  cards: {
    props: [
      { name: "items", type: "array", scope: "output" },
      { name: "title", type: "string", scope: "element" },
      { name: "description", type: "string", scope: "element" },
      { name: "bullets", type: "string[]", scope: "element" },
    ],
  },
  // A single output-scoped array prop: the display field's array renders as
  // inline pills. The single-prop default binding (empty path → root) means a
  // display field declares it with no props (`render: { kind: "chips" }`).
  chips: {
    props: [{ name: "items", type: "array", scope: "output" }],
  },
  json: { props: [] },
} as const satisfies Record<BuiltinRenderKind, RenderContract>;

// A dotted path into TOutput ("cardSpec.title"). The empty string resolves to
// the root. For a union output every member's paths are allowed (distributive),
// so a discriminated-union output (e.g. a plan proposal) accepts paths that
// exist on any member. Array and non-object outputs accept any path string —
// their element shapes are unknown to the hint's static type.
export type PropPath<TOutput> = TOutput extends object
  ? TOutput extends readonly unknown[]
    ? string
    : {
        [K in keyof TOutput & string]: K | `${K}.${PropPath<TOutput[K]>}`;
      }[keyof TOutput & string]
  : string;

// The serialized (runtime) render hint shape: kind open to any string, props a
// plain path map. This is the wire form and the erasure RenderHint compiles to.
export type RuntimeRenderHint = {
  kind: RenderKind;
  props?: Record<string, string>;
};

type ContractForKind<K extends BuiltinRenderKind> =
  (typeof builtinRenderContracts)[K];
type OutputPropNames<C extends RenderContract> = Extract<
  C["props"][number],
  { scope: "output" }
>["name"];
type ElementPropNames<C extends RenderContract> = Extract<
  C["props"][number],
  { scope: "element" }
>["name"];

// The compile-time checked hint for a built-in kind: props keys must be the
// kind's contract prop names; output-scoped prop values must be paths into the
// task output. Element-scoped prop values are left as strings — their
// resolution base (the items array element) depends on another prop's value,
// which TypeScript cannot express, so the runtime validates them.
export type BuiltinRenderHint<TOutput> = {
  [K in BuiltinRenderKind]: K extends "json"
    ? { kind: K; props?: Record<string, never> }
    : {
        kind: K;
        props?: {
          [P in OutputPropNames<ContractForKind<K>>]?: PropPath<TOutput>;
        } & {
          [P in ElementPropNames<ContractForKind<K>>]?: string;
        };
      };
}[BuiltinRenderKind];

// A render hint, authored against the task's output type. Built-in kinds are
// checked against their contract (Level B). Custom kinds are intentionally not
// writable through this default: the schema anticipates them (open kind
// strings, serialized contracts, runtime validation with json fallback), and
// widening TCustomRenderKinds to a definition's custom kind set is the
// boundary future work (serving custom components) will cross.
export type RenderHint<
  TOutput = unknown,
  TCustomRenderKinds extends string = never,
> =
  | BuiltinRenderHint<TOutput>
  | { kind: TCustomRenderKinds; props?: Record<string, PropPath<TOutput>> };

// A flow-declared custom render kind: a name and the input contract the
// rendering surface validates resolved props against at runtime.
export type CustomRenderKind = {
  kind: string;
  contract: RenderContract;
};

// A derived display: compute a value from the resolved field value instead of
// showing it raw. Structured (no expression language) and evaluated by a
// shared pure helper (derive-display.ts) that engine and UI both use, so the
// rendering is deterministic. `where.field` addresses an item property of the
// resolved array; `equals` compares with strict equality.
//
// The *Across kinds aggregate over the workflow's instances instead of the
// instance's own value: the display field's `path` names the instance-state
// field to count, and the server-computed WorkflowSummary rides each
