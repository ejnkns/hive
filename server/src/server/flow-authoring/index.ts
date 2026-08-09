/** The flow-authoring knowledge core: the single source of truth for how to
 * design and generate Hive flow definitions. Consumed by the in-product
 * generation prompt (`buildFlowAuthoringPrompt`) and rendered as the
 * human/agent-facing document (`flowAuthoringMarkdown`). */

export { DESIGN_DECISIONS } from "./decisions";
export {
  FLOW_PATTERNS,
  type FlowPattern,
  renderPatternsPrompt,
  STRUCTURED_INTAKE_EXEMPLAR,
} from "./patterns";
export { buildFlowAuthoringPrompt, flowAuthoringMarkdown } from "./prompt";
export { AUTHORING_RULES } from "./rules";
export { AUTHORING_DEFINITION_ID, authoringSessionFlow } from "./session";
export { buildAuthoringSessionPrompt } from "./session-prompt";
export { FLOW_SPEC_SHAPE } from "./vocabulary";
