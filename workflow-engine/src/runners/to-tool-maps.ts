/** @private — only imported by runners.ts */

import type { Tool, ToolDefinition, ToolExecutor } from "./tool-types";

// Splits a self-contained tool list into the two name-keyed maps the ai
// runners consume. The name comes from definition.function.name — the single
// source of truth. The composition root merges preset tools with the engine's
// infrastructure registry using this, then passes the merged maps to the
// runner factories.
export function toToolMaps(tools: readonly Tool[]): {
  definitions: Record<string, ToolDefinition>;
  executors: Record<string, ToolExecutor>;
} {
  const definitions: Record<string, ToolDefinition> = {};
  const executors: Record<string, ToolExecutor> = {};
  const seen = new Set<string>();

  for (const tool of tools) {
    const name = tool.definition.function.name;
    if (seen.has(name)) {
      throw new Error(`Duplicate tool name: ${name}`);
    }
    seen.add(name);
    definitions[name] = tool.definition;
    executors[name] = tool.executor;
  }

  return { definitions, executors };
}
