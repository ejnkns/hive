// Regenerates the human/agent-facing reference document from the flow-authoring
// knowledge core (single source of truth: server/src/server/flow-authoring/).
// Run from the server package: `node scripts/export-flow-authoring-doc.mjs`
// (or `pnpm --filter server export:flow-authoring`).

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flowAuthoringMarkdown } from "../src/server/flow-authoring.ts";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../../skills/flow-authoring/reference.md");

await writeFile(target, flowAuthoringMarkdown(), "utf-8");
console.log(`wrote ${target}`);
