/** @public — the generic flow rendering surface (Lit + Web Components). */

export type { WorkflowInstances } from "./flow-rendering/components/workflow-instances";
export {
  type ResolvedRender,
  resolveRender,
} from "./flow-rendering/contract-resolution";
export { defineFlowRenderingComponents } from "./flow-rendering/define-components";
export type { InstanceComponentProps } from "./flow-rendering/instance-component-props";
export { resolvePath } from "./flow-rendering/resolve-path";
