/** @public — the generic FlowRuntime registry. No domain (queen-bee) knowledge.
 * Import from here, not from flow-registry/ directly.
 *
 * Owns the process-global runtime map, the flow event hub, instance-config
 * validation, flow-level action dispatch, and the flow lifecycle
 * (createFlow / rehydrateFlow). Implementation lives in flow-registry/: the
 * state + event hub (registry-state), instance-config validation
 * (instance-config), flow-level actions (flow-actions), and the lifecycle
 * (flow-lifecycle). */

export type {
  FlowLevelActionDispatchResult,
  FlowLevelActionView,
} from "./flow-registry/flow-actions";
export {
  dispatchFlowLevelAction,
  getAvailableFlowActions,
} from "./flow-registry/flow-actions";
export {
  createFlow,
  rehydrateFlow,
} from "./flow-registry/flow-lifecycle";
export { validateInstanceConfig } from "./flow-registry/instance-config";
export type { FlowEventBusEvent } from "./flow-registry/registry-state";
export {
  getFlowPersistence,
  getFlowRuntime,
  getFlowRuntimes,
  onFlowEvent,
  purgeFlow,
  registerFlowForTest,
  resetFlowRuntimesForTest,
  setFlowPersistence,
  unlinkFlow,
} from "./flow-registry/registry-state";
