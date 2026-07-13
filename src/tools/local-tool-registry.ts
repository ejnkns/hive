import { readFileTool } from "./local-tool-registry/read-file";
import { runCommandTool } from "./local-tool-registry/run-command";
import { writeFileTool } from "./local-tool-registry/write-file";
import type {
  Tool,
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolRegistry,
  ToolResult,
} from "./tool";

const BUILT_IN_TOOLS: Tool[] = [readFileTool, writeFileTool, runCommandTool];

export type LocalToolRegistryConfig = {
  workspacePath: string;
};

export function createLocalToolRegistry(
  _config: LocalToolRegistryConfig
): ToolRegistry {
  const toolsByName = new Map<string, Tool>(
    BUILT_IN_TOOLS.map((t) => [t.definition.function.name, t])
  );

  function getDefinitions(): ToolDefinition[] {
    return BUILT_IN_TOOLS.map((t) => t.definition);
  }

  async function execute(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = toolsByName.get(toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        content: `unknown tool: ${toolCall.name}`,
        isError: true,
      };
    }
    return tool.execute(toolCall, {
      ...context,
      workspacePath: _config.workspacePath,
    });
  }

  return { getDefinitions, execute };
}
