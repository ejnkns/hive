/** The flow-authoring knowledge, read at runtime from the self-contained
 * skill (`skills/flow-authoring/` at the repo root — the installed skill
 * directory). The markdown files are the single source of truth: the
 * authoring session prompt embeds `decisions` and the `read_authoring_knowledge`
 * tool serves `vocabulary`/`rules` on demand. There is no render step — edit
 * the markdown and the runtime sees it (cache invalidates on restart).
 * `capabilities` is NOT here: it is the engine's own manifest
 * (`workflow-engine/capabilities-manifest`), consumed by the tool directly. */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findServerPackageRoot } from "../flow-definitions.ts";

export type KnowledgeTopic = "decisions" | "rules" | "vocabulary" | "styling";

const KNOWLEDGE_FILES: Record<KnowledgeTopic, string> = {
  decisions: "decisions.md",
  rules: "rules.md",
  vocabulary: "vocabulary.md",
  styling: "styling.md",
};

// Read once per process; the files are static knowledge, not live documents.
const cache = new Map<KnowledgeTopic, string>();

export function readKnowledge(topic: KnowledgeTopic): string {
  const cached = cache.get(topic);
  if (cached !== undefined) return cached;
  const skillDir = resolve(findServerPackageRoot(), "../skills/flow-authoring");
  const file = join(skillDir, KNOWLEDGE_FILES[topic]);
  if (!existsSync(file)) {
    throw new Error(`Flow-authoring knowledge file missing: ${file}`);
  }
  const content = readFileSync(file, "utf-8");
  cache.set(topic, content);
  return content;
}
