/** @public — the flow-authoring session surface: the hidden authoring flow
 * and the session system prompt. The knowledge (decisions/rules/vocabulary)
 * lives in the self-contained skill (`skills/flow-authoring/*.md`) and is
 * read at runtime via `flow-authoring/knowledge.ts`; import the session
 * machinery from here, not from flow-authoring/ directly. */

export {
  type KnowledgeTopic,
  readKnowledge,
} from "./flow-authoring/knowledge.ts";
export {
  AUTHORING_DEFINITION_ID,
  authoringSessionFlow,
} from "./flow-authoring/session.ts";
export { buildAuthoringSessionPrompt } from "./flow-authoring/session-prompt.ts";
