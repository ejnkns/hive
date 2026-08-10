/** @public — the flow-authoring knowledge core: the single source of truth
 * for how to design and generate Hive flow definitions. Consumed by the
 * in-product generation prompt (`buildFlowAuthoringPrompt`) and rendered as
 * the human/agent-facing document (`flowAuthoringMarkdown`). Import from
 * here, not from flow-authoring/ directly. */

export { DESIGN_DECISIONS } from "./flow-authoring/decisions";
export {
  FLOW_PATTERNS,
  type FlowPattern,
  renderPatternsPrompt,
  STRUCTURED_INTAKE_EXEMPLAR,
} from "./flow-authoring/patterns";
export {
  buildFlowAuthoringPrompt,
  flowAuthoringMarkdown,
} from "./flow-authoring/prompt";
export { AUTHORING_RULES } from "./flow-authoring/rules";
export {
  AUTHORING_DEFINITION_ID,
  authoringSessionFlow,
} from "./flow-authoring/session";
export { buildAuthoringSessionPrompt } from "./flow-authoring/session-prompt";
export { FLOW_SPEC_SHAPE } from "./flow-authoring/vocabulary";
