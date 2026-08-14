/** Assembles the flow-authoring knowledge into its consumable form: a
 * human/agent-facing document (the external reference rung of the
 * flow-authoring skill). Single source of truth: the content modules
 * (decisions, patterns, rules, vocabulary) are the knowledge; this file only
 * orders and renders it. */

import { authoringGuide } from "workflow-engine/capabilities-manifest";
import { DESIGN_DECISIONS } from "./decisions.ts";
import { renderPatternsPrompt } from "./patterns.ts";
import { AUTHORING_RULES } from "./rules.ts";
import { FLOW_DEFINITION_SHAPE } from "./vocabulary.ts";

export function flowAuthoringMarkdown(): string {
  return [
    "# Flow Authoring — the Hive skill",
    "",
    "The knowledge for designing Hive flow definitions. This document is rendered from the authoring knowledge modules (`server/src/server/flow-authoring/`), so it cannot drift from what the authoring session teaches the agent.",
    "",
    DESIGN_DECISIONS,
    "",
    renderPatternsPrompt(),
    "",
    AUTHORING_RULES,
    "",
    "## Vocabulary",
    FLOW_DEFINITION_SHAPE,
    "",
    "## Engine capabilities",
    authoringGuide(),
    "",
  ].join("\n");
}
