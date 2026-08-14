/** @private — the read_authoring_knowledge tool: the session agent's on-demand
 * reference. Only flow-authoring/session/tools.ts imports this. */

import { authoringGuide } from "workflow-engine/capabilities-manifest";
import { defineTool } from "workflow-engine/runners";
import { renderPatternsPrompt } from "../../patterns.ts";
import { AUTHORING_RULES } from "../../rules.ts";
import { FLOW_DEFINITION_SHAPE } from "../../vocabulary.ts";
import type { AuthoringItemState } from "../state.ts";

// The knowledge reference the session agent consults on demand (progressive
// disclosure): each topic returns the relevant module so the system prompt can
// stay compact and the agent reads only what it needs when drafting.
const KNOWLEDGE_TOPICS: Record<string, string> = {
  vocabulary: FLOW_DEFINITION_SHAPE,
  patterns: renderPatternsPrompt(),
  capabilities: authoringGuide(),
  rules: AUTHORING_RULES,
};

export const readAuthoringKnowledgeTool = defineTool<AuthoringItemState>({
  name: "read_authoring_knowledge",
  description:
    "Read a section of the flow-authoring reference before writing or extending a definition. Topics: 'vocabulary' (the FlowDefinition data shape and constraints), 'patterns' (tested lifecycle exemplars), 'capabilities' (engine operations, infrastructure tools, state fields), or 'rules' (failure-mode guardrails).",
  parameters: {
    properties: {
      topic: {
        type: "string",
        enum: ["vocabulary", "patterns", "capabilities", "rules"],
      },
    },
    required: ["topic"],
  },
  executor: async (call) => {
    const args = JSON.parse(call.arguments) as { topic?: string };
    const content = args.topic ? KNOWLEDGE_TOPICS[args.topic] : undefined;
    return content === undefined
      ? {
          toolCallId: call.id,
          content: `Unknown topic "${args.topic}". Topics: ${Object.keys(KNOWLEDGE_TOPICS).join(", ")}`,
          isError: true,
        }
      : { toolCallId: call.id, content, isError: false };
  },
});
