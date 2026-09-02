/** @private — the read_authoring_knowledge tool: the session agent's on-demand
 * reference. Only flow-authoring/session/tools.ts imports this. */

import { authoringGuide } from "workflow-engine/capabilities-manifest";
import { defineTool } from "workflow-engine/runners";
import { readKnowledge } from "../../knowledge.ts";
import type { AuthoringItemState } from "../state.ts";

// The knowledge reference the session agent consults on demand (progressive
// disclosure): each topic returns the relevant knowledge so the system prompt
// can stay compact and the agent reads only what it needs when drafting.
// vocabulary/rules are the skill's markdown files (the skill dir is the
// single source of truth); capabilities is the engine's own manifest.
const KNOWLEDGE_TOPICS: Record<string, string> = {
  vocabulary: readKnowledge("vocabulary"),
  capabilities: authoringGuide(),
  rules: readKnowledge("rules"),
  styling: readKnowledge("styling"),
};

export const readAuthoringKnowledgeTool = defineTool<AuthoringItemState>({
  name: "read_authoring_knowledge",
  description:
    "Read a section of the flow-authoring reference before writing or extending a definition. Topics: 'vocabulary' (the FlowDefinition data shape and constraints), 'capabilities' (engine operations, infrastructure tools, state fields), 'rules' (failure-mode guardrails), or 'styling' (the utility-class vocabulary for flow UIs).",
  parameters: {
    properties: {
      topic: {
        type: "string",
        enum: ["vocabulary", "capabilities", "rules", "styling"],
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
