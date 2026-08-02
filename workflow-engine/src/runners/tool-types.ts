/** @public — shared types for the built-in runners subtree and the engine's core schema (workflow-types). */
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameterSchema>;
      required: string[];
    };
  };
};

export type ToolParameterSchema = {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameterSchema;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
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

export type ToolContext = {
  workspacePath: string;
  // The flow's base directory (e.g. the bound repo root) when the runner
  // knows it. Tools that persist flow-level state (a requirements draft, a
  // board) write relative to this; falls back to workspacePath when unset.
  basePath?: string;
  // The workflow instance this task runs in (e.g. the card id) when known.
  instanceId?: string;
  // Patches the workflow instance's domain data. Tools use this to record
  // session running state (e.g. the requirements draft) instead of writing
  // files; the engine persists it as part of the instance.
  patchWorkflowInstanceState?: (patch: Record<string, unknown>) => void;
  signal?: AbortSignal;
  baseCommit?: string;
  projectRevision?: string;
};

export type ToolExecutor = (
  call: ToolCall,
  ctx: ToolContext
) => Promise<ToolResult>;

// The names of the infrastructure tools the engine ships. Every flow can
// reference these in a task's tools; a preset's domain tools add more names.
// The tool name is the single source of truth — a Tool's definition and
// executor are both keyed by definition.function.name.
export type InfrastructureToolName =
  | "read_file"
  | "list_directory"
  | "search_code"
  | "write_file"
  | "run_command"
  | "git_status"
  | "git_diff"
  | "git_log"
  | "git_show"
  | "commit_work";

// A self-contained tool: the schema the model is offered plus the executor
// that implements it. The engine never interprets a Tool's meaning — it
// only offers the definition and invokes the executor. Infrastructure tools
// ship in the engine; domain tools ship in a preset. Both are the same shape.
export type Tool = {
  definition: ToolDefinition;
  executor: ToolExecutor;
};

// A tool name in a task definition. Known infrastructure tool names get
// literal autocomplete; the open `string & {}` arm keeps the union from
// collapsing to plain string so domain tool names (unknown to the engine)
// are still accepted. Resolution against the merged registry (infrastructure
// + the flow's domain tools) happens at runtime.
export type ToolName = InfrastructureToolName | (string & {});
