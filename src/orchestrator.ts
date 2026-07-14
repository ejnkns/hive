/** @public — orchestrator module API. Import from here, not from orchestrator/ directly. */

export type { HandleOrchestrate } from "./orchestrator/create-handler";
export { createOrchestratorHandler } from "./orchestrator/create-handler";
export { orchestrate } from "./orchestrator/orchestrate";
export type {
  CompletionRequest,
  CompletionResponse,
  ModelCaller,
  OrchestrationConfig,
  OrchestrationResult,
} from "./orchestrator/types";
