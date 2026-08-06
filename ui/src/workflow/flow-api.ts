import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type {
  ActionVariant,
  ConfigField,
  CustomRenderKind,
} from "workflow-engine/workflow-types";

// The flow API envelope types and client functions. Workflow rendering types
// come from the engine (WorkflowDefResponse, WorkflowInstanceEntry, ...) — this
// module only holds the wire shapes and the REST calls.

export type FlowStatus = "error" | "running" | "waiting" | "idle" | "complete";

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
  config?: Record<string, unknown>;
  workflows: WorkflowDefResponse[];
  instances: WorkflowInstanceEntry[];
  ui?: {
    kinds?: CustomRenderKind[];
    // Declared served component ids → fetch path (transpiled module source).
    components?: Record<string, string>;
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
};

export type FlowDefinitionDetail = FlowDefinitionSummary & {
  source: string;
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

// Push-authoritative frames the flow WebSocket sends. The server pushes
// self-contained whole-flow snapshots; the client replaces its store entry
// directly instead of refetching over REST. init replaces the whole store on
// connect and reconnect re-sync.
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
  input: { name: string; description?: string; source: string }
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

export async function generateFlowDefinition(
  prompt: string
): Promise<{ source: string }> {
  const res = await fetch("/api/flows/definitions/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    // Error response shape is guaranteed by the server endpoint
    const err = (await res.json()) as { error?: string };
    throw new Error(
      err.error ?? `Failed to generate definition: ${res.statusText}`
    );
  }
  // Success response shape is guaranteed by the server endpoint
  return (await res.json()) as { source: string };
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
  actionId: string
): Promise<DispatchActionResult> {
  const res = await fetch(
    `/api/flows/${encodeURIComponent(flowId)}/instances/${encodeURIComponent(instanceId)}/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId }),
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
