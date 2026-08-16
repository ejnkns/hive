// The workflow-instance component props contract. The type lives in the
// engine (workflow-engine/workflow-types) so definition component modules can
// type their components with a type-only import from the module-set allowlist;
// the UI re-exports it unchanged for the rendering surface.
export type { InstanceComponentProps } from "workflow-engine/workflow-types";
