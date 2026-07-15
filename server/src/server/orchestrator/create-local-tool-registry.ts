import { readFileTool } from "./create-local-tool-registry/read-file";
import { runCommandTool } from "./create-local-tool-registry/run-command";
import { writeFileTool } from "./create-local-tool-registry/write-file";

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ToolResult = {
  toolCallId: string;
  content: string;
  isError: boolean;
};

export type ToolExecutionContext = {
  sessionId: string;
  workspacePath: string;
};

export type Tool = {
  definition: ToolDefinition;
  execute: (
    toolCall: ToolCall,
    context: ToolExecutionContext
  ) => Promise<ToolResult>;
};

export type ToolRegistry = {
  getDefinitions: () => ToolDefinition[];
  execute: (
    toolCall: ToolCall,
    context: ToolExecutionContext
  ) => Promise<ToolResult>;
};

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
