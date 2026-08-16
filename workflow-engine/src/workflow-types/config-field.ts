/** @private — the ConfigField input/validation contract. */

export type ConfigFieldType =
  | "string"
  | "boolean"
  | "number"
  | "textarea"
  | "date"
  | "datetime"
  | "string[]";

// A field a definition's instances take as input at instantiation time.
// Declared by the definition (configSchema) and rendered by the UI as a form;
// the server validates instance config against it (required fields, types,
// unknown-field rejection).
export type ConfigField = {
  key: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  hint?: string;
  // Placeholder text inside the input. Unlike `hint` (helper text under the
  // field), this fills the control's empty state.
  placeholder?: string;
  // Pre-fill value. Rendered as the control's initial value when the form
  // opens (createInstance forms, and the gap-2 instance-edit form which passes
  // the current instance state through this prop).
  defaultValue?: string | boolean | number | string[];
  // For string fields: a closed set of allowed values. The server still
  // validates the value as a string; the UI renders a select instead of a free
  // text input. Optional and additive — absent means free text. For "string[]"
  // fields: the closed set a multi-select may choose from; absent means a free
  // tag list.
  options?: string[];
  // E4: dynamic select options sourced from flowState at runtime (e.g. the
  // AI-proposed category taxonomy). `flowState` is a dotted path into the
  // flow's declared flowState (e.g. "taxonomy.categories" — the first segment
  // must be a declared flowState field). The server resolves it to `options`
  // when serializing instance entries; when flowState lacks the value the
  // field falls back to free text (no options). Mutually exclusive with
  // `options` — a field has either a static closed set or a runtime source.
  optionsFrom?: { flowState: string };
};

// A project-level action rendered on the flow instance header. Unlike a
// ManualAction (which lives on a workflow state), a flow-level action is
// declared on the FlowDefinition and may create a new workflow instance or
