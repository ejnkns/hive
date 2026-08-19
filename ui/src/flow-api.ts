import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type {
  ActionVariant,
  ConfigField,
  CustomRenderKind,
} from "workflow-engine/workflow-types";

/** @public — the flow REST client. Shared by the Svelte app shell and the
 * Lit rendering surface (flow-create-form, flow-editor) at the ui/src fork.
 * Workflow rendering types come from the engine
 * (WorkflowDefResponse, WorkflowInstanceEntry, ...) — this module only holds
 * the wire shapes and the REST calls. */

export type FlowStatus = "error" | "running" | "waiting" | "idle" | "complete";

// Declarative theming tokens for the generic flow surfaces (flows-list card +
// flow pages). One accent; the renderer derives tint/text/ring via color-mix.
export type FlowTheme = {
  accent?: string; // one #rrggbb hex value
  emblem?: string; // a single character badge beside the definition name
};

// The gate-evaluated, UI-facing view of a flow-level action.
export type FlowLevelAction = {
  id: string;
  label: string;
  variant: ActionVariant;
  createInstance?: { workflowId: string; fields: ConfigField[] };
  dispatchToAll?: { workflowId: string; actionId: string };
};

export type FlowResponse = {
  id: string;
  label: string;
  status: FlowStatus;
  // Hidden definitions (the flow-authoring session) are driven by the
  // definition editor, not the flow library.
  hidden?: boolean;
  config?: Record<string, unknown>;
  workflows: WorkflowDefResponse[];
  instances: WorkflowInstanceEntry[];
  ui?: {
    kinds?: CustomRenderKind[];
    // Declared served component ids → fetch path (transpiled module source).
    components?: Record<string, string>;
    // A served component id rendering the whole flow-instance page body.
    flowComponent?: string;
    // Declarative theme tokens for the generic flow surfaces.
    theme?: FlowTheme;
    // Persisted domain files the UI may read (declared by the definition as
    // ui.persistedOutputs / ui.persistedOutputDirs): fixed paths → contents,
    // and directory names → file name → contents.
    persistedOutputs?: Record<string, string>;
    persistedOutputDirs?: Record<string, Record<string, string>>;
  };
  availableFlowActions: FlowLevelAction[];
};

export type FlowsApiResponse = {
  flows: FlowResponse[];
};

export type FlowDefinitionSummary = {
  id: string;
  name: string;
  description?: string;
  builtIn: boolean;
  configSchema: ConfigField[];
  // The definition's declarative theme tokens (generic flow surfaces).
  theme?: FlowTheme;
  // Schema-consistency findings from the save path (non-blocking; the
  // definition is saved regardless — these annotate it for the author).
  checkWarnings?: string[];
  checkErrors?: string[];
};

// The AI generation loop's outcome: whether the rendered definition passed
// the gate (transpile + schema-consistency + typecheck), how many attempts it
// took, and the final findings. `errors` are non-empty only when !passed.
export type GenerationReport = {
  passed: boolean;
  attempts: number;
  errors: string[];
  warnings: string[];
};

export type FlowDefinitionDetail = FlowDefinitionSummary & {
  source: string;
  // The referenced file set of a module-set definition (used to seed a
  // revision session's editor tabs).
  files?: Record<string, string>;
  // The pure-data form of a definition module (the builder contract — the
  // editor's Definition tab binds to it).
  definition?: unknown;
};

export type InstancesApiResponse = {
  instances: WorkflowInstanceEntry[];
};

export type DispatchActionResult = {
  instanceId: string;
  previousState: string;
  currentState: string;
  state: WorkflowInstanceEntry["state"];
  availableActions: WorkflowInstanceEntry["availableActions"];
};

export type TaskInputResult = {
  sent: boolean;
  instanceId: string;
  runningTaskContext: WorkflowInstanceEntry["state"]["runningTaskContext"];
};

export type PatchInstanceStateResult = {
  instanceId: string;
  state: WorkflowInstanceEntry["state"];
  availableActions: WorkflowInstanceEntry["availableActions"];
};

// Push-authoritative frames the flow WebSocket sends. The server pushes
// self-contained whole-flow snapshots; the client applies them to its store
// entry directly instead of refetching over REST. init merges non-destructively
// on connect and reconnect (upserting the frame's flows, keeping flows the
// frame is momentarily missing); flow_deleted is the only removal path.
export type FlowWsMessage =
  | { type: "init"; flows: FlowResponse[] }
  | { type: "flow_snapshot"; flow: FlowResponse }
  | { type: "flow_deleted"; flowId: string };

export async function fetchFlows(options?: {
  definitionId?: string;
  name?: string;
}): Promise<FlowResponse[]> {
  const query = new URLSearchParams();
  if (options?.definitionId) query.set("definitionId", options.definitionId);
  if (options?.name) query.set("name", options.name);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const res = await fetch(`/api/flows${suffix}`);
  if (!res.ok) throw new Error(`Failed to fetch flows: ${res.statusText}`);
  // res.json() returns unknown; the API response shape is guaranteed by
  // the server endpoint and validated by the return type
  const data = (await res.json()) as FlowsApiResponse;
  return data.flows;
}

export async function fetchFlow(flowId: string): Promise<FlowResponse> {
  const res = await fetch(`/api/flows/${encodeURIComponent(flowId)}`);
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? `Failed to fetch flow: ${res.statusText}`);
  }
  // Success response shape matches FlowResponse by contract with the server
  return (await res.json()) as FlowResponse;
}

export async function createFlow(input: {
  definitionId: string;
  flowId?: string;
  config?: Record<string, unknown>;
}): Promise<{ flowId: string }> {
  const res = await fetch("/api/flows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? `Failed to create flow: ${res.statusText}`);
  }
  // Success response shape is guaranteed by the server endpoint
  const data = (await res.json()) as { ok: boolean; flowId: string };
  return { flowId: data.flowId };
}

// Creates a flow-authoring session (a hidden flow instance whose ai-chat
// agent converges on the definition module with the user) and returns the
// session ids. When `lucky` is true the agent is told to produce the
// definition without questions.
export async function authorFlowDefinition(input: {
  prompt: string;
  lucky?: boolean;
  // Optional extra context for the first message (e.g. an existing definition
  // source the agent should revise).
  context?: string;
  // The definition module the session starts from — a new flow's (possibly
  // hand-edited) scaffold, so the editor's Definition tab shows it from turn
  // zero and the agent's first read_definition_source sees it.
  source?: string;
  // The referenced file set of an existing definition being revised — the
  // session seeds its module set from these so the file tabs and the agent's
  // file tools see the current files.
  files?: Record<string, string>;
}): Promise<{ flowId: string; instanceId: string }> {
  const res = await fetch("/api/flows/definitions/author", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(
      err.error ?? `Failed to start authoring: ${res.statusText}`
    );
  }
  // Success response shape is guaranteed by the server endpoint
  return (await res.json()) as { flowId: string; instanceId: string };
}

// The synchronous save behind the editor's Save button: runs the same
// saveAuthoringDefinition core as the agent's save_definition tool, patches
// the session instance state (savedDefinitionId + findings), and returns
// immediately — no agent turn.
export async function saveAuthoringDefinition(flowId: string): Promise<{
  id: string;
  name: string;
  checkErrors: string[];
  checkWarnings: string[];
}> {
  const res = await fetch(
    `/api/flows/definitions/author/${encodeURIComponent(flowId)}/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(
      err.error ?? `Failed to save definition: ${res.statusText}`
    );
  }
  // Success response shape is guaranteed by the server endpoint
  return (await res.json()) as {
    id: string;
    name: string;
    checkErrors: string[];
    checkWarnings: string[];
  };
}

// The write-back behind the flow-editor's editable code pane: patches the
// human's current definition module into the session. The edit IS the state —
// one artifact; no divergence flag, no adoption.
export async function saveAuthoringSource(
  flowId: string,
  source: string
): Promise<void> {
  const res = await fetch(
    `/api/flows/definitions/author/${encodeURIComponent(flowId)}/source`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    }
  );
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to save source");
  }
}

// The write-back behind the flow-editor's file tabs: writes a referenced file
// of the session's module set authoritatively (the file IS the truth — no
// divergence flag).
export async function saveAuthoringFile(
  flowId: string,
  path: string,
  content: string
): Promise<void> {
  const res = await fetch(
    `/api/flows/definitions/author/${encodeURIComponent(flowId)}/files`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }
  );
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to save file");
  }
}

export async function deleteFlow(flowId: string, purge = false): Promise<void> {
  const res = await fetch(`/api/flows/${encodeURIComponent(flowId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purge }),
  });
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? `Failed to delete flow: ${res.statusText}`);
  }
}

// The canonical scaffold for a new flow: the single server-owned definition
// module the new-flow editor shows as its editable draft (the editor never
// carries its own copy).
export async function fetchFlowScaffold(): Promise<string> {
  const res = await fetch("/api/flows/definitions/scaffold");
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? `Failed to fetch scaffold: ${res.statusText}`);
  }
  // Success response shape is guaranteed by the server endpoint
  return ((await res.json()) as { source: string }).source;
}

// The declared refs + label of a draft definition module: the new-flow
// editor derives its file tabs from the refs (declared-but-unwritten refs get
// an empty tab, like the session editor) and defaults the hand-write Save's
// name to the label.
export async function parseDefinitionRefs(
  source: string
): Promise<{ refs: string[]; label: string }> {
  const res = await fetch("/api/flows/definitions/refs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(
      err.error ?? `Failed to parse definition: ${res.statusText}`
    );
  }
  // Success response shape is guaranteed by the server endpoint
  return (await res.json()) as { refs: string[]; label: string };
}

export async function fetchFlowDefinitions(): Promise<FlowDefinitionSummary[]> {
  const res = await fetch("/api/flows/definitions");
  if (!res.ok)
    throw new Error(`Failed to fetch definitions: ${res.statusText}`);
  // res.json() returns unknown; the API response shape is guaranteed by
  // the server endpoint and validated by the return type
  const data = (await res.json()) as {
    definitions: FlowDefinitionSummary[];
  };
  return data.definitions;
}

export async function fetchFlowDefinition(
  id: string
): Promise<FlowDefinitionDetail> {
  const res = await fetch(`/api/flows/definitions/${encodeURIComponent(id)}`);
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(
      err.error ?? `Failed to fetch definition: ${res.statusText}`
    );
  }
  // Success response shape matches FlowDefinitionDetail by contract with the server
  return (await res.json()) as FlowDefinitionDetail;
}

export async function createFlowDefinition(input: {
  name: string;
  description?: string;
  source: string;
  // The referenced file set of the definition (hand-written files, saved
  // together with the module through the same seam the session save uses).
  files?: Record<string, string>;
}): Promise<FlowDefinitionSummary> {
  const res = await fetch("/api/flows/definitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(
      err.error ?? `Failed to create definition: ${res.statusText}`
    );
  }
  // Success response shape matches FlowDefinitionSummary by contract with the server
  return (await res.json()) as FlowDefinitionSummary;
}

export async function updateFlowDefinition(
  id: string,
  input: {
    name: string;
    description?: string;
    source: string;
    files?: Record<string, string>;
  }
): Promise<FlowDefinitionSummary> {
  const res = await fetch(`/api/flows/definitions/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(
      err.error ?? `Failed to update definition: ${res.statusText}`
    );
  }
  // Success response shape matches FlowDefinitionSummary by contract with the server
  return (await res.json()) as FlowDefinitionSummary;
}

export async function deleteFlowDefinition(id: string): Promise<void> {
  const res = await fetch(`/api/flows/definitions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(
      err.error ?? `Failed to delete definition: ${res.statusText}`
    );
  }
}

// The validate-without-save gate: transpile+load, schema-consistency, and the
// per-definition typecheck, reported without registering anything.
export type ValidateResult = {
  ok: boolean;
  loadError?: string;
  checkErrors: string[];
  checkWarnings: string[];
  typeErrors: { code: number; message: string; line: number; column: number }[];
};

export async function validateFlowDefinition(
  source: string
): Promise<ValidateResult> {
  const res = await fetch("/api/flows/definitions/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(
      err.error ?? `Failed to validate definition: ${res.statusText}`
    );
  }
  // Success response shape is guaranteed by the server endpoint
  return (await res.json()) as ValidateResult;
}

export async function fetchFlowInstances(
  flowId: string
): Promise<WorkflowInstanceEntry[]> {
  const res = await fetch(`/api/flows/${encodeURIComponent(flowId)}/instances`);
  if (!res.ok) throw new Error(`Failed to fetch instances: ${res.statusText}`);
  // res.json() returns unknown; the API response shape is guaranteed by
  // the server endpoint and validated by the return type
  const data = (await res.json()) as InstancesApiResponse;
  return data.instances;
}

export async function dispatchAction(
  flowId: string,
  instanceId: string,
  actionId: string,
  payload?: Record<string, unknown>
): Promise<DispatchActionResult> {
  const res = await fetch(
    `/api/flows/${encodeURIComponent(flowId)}/instances/${encodeURIComponent(instanceId)}/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId, payload }),
    }
  );

  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? `Action rejected: ${res.statusText}`);
  }

  // Success response shape matches DispatchActionResult by contract with the server
  return (await res.json()) as DispatchActionResult;
}

export async function dispatchFlowAction(
  flowId: string,
  actionId: string,
  payload: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `/api/flows/${encodeURIComponent(flowId)}/actions/${encodeURIComponent(actionId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? `Flow action rejected: ${res.statusText}`);
  }

  // Success response shape is guaranteed by the server endpoint
  return (await res.json()) as Record<string, unknown>;
}

export async function patchInstanceState(
  flowId: string,
  instanceId: string,
  values: Record<string, unknown>
): Promise<PatchInstanceStateResult> {
  const res = await fetch(
    `/api/flows/${encodeURIComponent(flowId)}/instances/${encodeURIComponent(instanceId)}/state`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    }
  );

  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? `State patch rejected: ${res.statusText}`);
  }

  // Success response shape matches PatchInstanceStateResult by contract with
  // the server endpoint
  return (await res.json()) as PatchInstanceStateResult;
}

export async function sendTaskInput(
  flowId: string,
  instanceId: string,
  content: string
): Promise<TaskInputResult> {
  const res = await fetch(
    `/api/flows/${encodeURIComponent(flowId)}/instances/${encodeURIComponent(instanceId)}/task/input`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );

  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? `Failed to send input: ${res.statusText}`);
  }

  // Success response shape matches TaskInputResult by contract with the server
  return (await res.json()) as TaskInputResult;
}
