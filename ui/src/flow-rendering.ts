/** @public — the generic flow rendering surface (Lit + Web Components). */

export type { WorkflowInstances } from "./flow-rendering/components/workflow-instances.ts";
export {
  type ResolvedRender,
  resolveRender,
} from "./flow-rendering/contract-resolution.ts";
export { defineFlowRenderingComponents } from "./flow-rendering/define-components.ts";
export type { InstanceComponentProps } from "./flow-rendering/instance-component-props.ts";
export { resolvePath } from "./flow-rendering/resolve-path.ts";
