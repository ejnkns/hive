/** Assembles the flow-authoring knowledge into its two consumable forms:
 *
 *  - `buildFlowAuthoringPrompt()` — the system prompt for the in-product
 *    generation loop (decisions → patterns → rules → vocabulary →
 *    capabilities, most-actionable first).
 *  - `flowAuthoringMarkdown()` — the same knowledge as a human/agent-facing
 *    document (the external reference rung of the flow-authoring skill).
 *
 * Single source of truth: the content modules (decisions, patterns, rules,
 * vocabulary) are the knowledge; this file only orders and renders it. */

import { authoringGuide } from "workflow-engine/capabilities-manifest";
import { DESIGN_DECISIONS } from "./decisions.ts";
import { renderPatternsPrompt } from "./patterns.ts";
import { AUTHORING_RULES } from "./rules.ts";
import { FLOW_BLUEPRINT_SHAPE } from "./vocabulary.ts";

export function buildFlowAuthoringPrompt(): string {
  return [
    "You design flow definitions for the Hive workflow engine. The engine provides the capabilities at the bottom for free; a flow only declares its domain. Follow the process: first design the flow, then emit the JSON FlowBlueprint.",
    "",
    DESIGN_DECISIONS,
    "",
    renderPatternsPrompt(),
    "",
    AUTHORING_RULES,
    "",
    FLOW_BLUEPRINT_SHAPE,
    "",
    "## Capabilities (what the engine provides for free)",
    authoringGuide(),
    "",
    "## Process",
    "1. Design the flow: entities and their lifecycles, where AI is used, what structured data each ai-task returns, how a human drives it, how workflows connect, and the error escape hatch. Keep the design short (3-8 bullet lines).",
    "2. Emit the JSON FlowBlueprint in a single fenced code block. No prose outside the design, no TypeScript.",
    "3. On validation feedback, fix every listed issue and emit a corrected blueprint — revise the design too if the feedback says the design is wrong.",
  ].join("\n");
}

export function flowAuthoringMarkdown(): string {
  return [
    "# Flow Authoring — the Hive skill",
    "",
    "The knowledge for designing and generating Hive flow definitions. This document is rendered from the same modules the in-product generation prompt uses (`server/src/server/flow-authoring/`), so it cannot drift from what the generator teaches the model.",
    "",
    DESIGN_DECISIONS,
    "",
    renderPatternsPrompt(),
    "",
    AUTHORING_RULES,
    "",
    "## Vocabulary",
    FLOW_BLUEPRINT_SHAPE,
    "",
    "## Engine capabilities",
    authoringGuide(),
    "",
  ].join("\n");
}
