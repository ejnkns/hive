/** @public — the consumer-facing factory for a self-contained domain tool. */

import type {
  Tool,
  ToolCall,
  ToolContext,
  ToolParameterSchema,
  ToolResult,
} from "./tool-types.ts";

// A tool authored without the OpenAI function-call envelope: the factory
// derives `{ type: "function", function: { name, description, parameters } }`
// from these fields. `parameters` carries the top-level `properties`/`required`
// directly; nested schemas keep their own `type`.
export type ToolAuthoring<
  TState extends Record<string, unknown> = Record<string, unknown>,
> = {
  name: string;
  description: string;
  parameters?: {
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  };
  // The executor's context is typed against the workflow's state when the tool
  // records instance state (e.g. `defineTool<RequirementsItemState>`); tools
  // that don't patch state just omit the generic.
  executor: (
    call: ToolCall,
    ctx: ToolContext<TState>
  ) => ToolResult | Promise<ToolResult>;
};

// Builds a `Tool` from a flat declaration, binding the workflow's state type
// (when declared) so patches are type-checked against it. The runtime context
// is erased; the single cast here is the erasure point for the tool.
export function defineTool<
  TState extends Record<string, unknown> = Record<string, unknown>,
>(config: ToolAuthoring<TState>): Tool {
  return {
    definition: {
      type: "function",
      function: {
        name: config.name,
        description: config.description,
        parameters: {
          type: "object",
          properties: config.parameters?.properties ?? {},
          required: config.parameters?.required ?? [],
        },
      },
    },
    executor: config.executor as Tool["executor"],
  };
}
