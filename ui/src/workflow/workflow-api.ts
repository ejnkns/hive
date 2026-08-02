export type ActionDef = {
  id: string;
  label: string;
  variant: "primary" | "secondary" | "destructive" | "default";
};

export type StateDef = {
  id: string;
  label: string;
  description?: string;
  category?: "initial" | "active" | "terminal" | "error";
  actions: ActionDef[];
};

export type WorkflowDef = {
  id: string;
  label: string;
  description?: string;
  // UI-side rendering hint for derived views; never stored. The title is a
  // dotted path into the instance's workflowInstanceState.
  item?: { title: string; subtitle?: string };
  states: StateDef[];
  initial: string;
  terminalStates: string[];
};

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
};

export type RunningTaskContext =
  | {
      role: "ai-task";
      messages: ChatMessage[];
    }
  | {
      role: "ai-chat";
      messages: ChatMessage[];
      sessionId: string;
    }
  | {
      role: "operation";
    };

export type WorkflowInstanceState = {
  currentState: string;
  taskOutputs: Record<string, unknown>;
  hasRunningTask: boolean;
  runningTaskId: string | null;
  runningTaskContext: RunningTaskContext | null;
  workflowInstanceState: Record<string, unknown>;
  history: unknown[];
};

export type VisibleAction = {
  id: string;
  label: string;
  variant: "primary" | "secondary" | "destructive" | "default";
};

export type WorkflowInstanceEntry = {
  id: string;
  workflowId: string;
  state: WorkflowInstanceState;
  availableActions: VisibleAction[];
};

export type FlowStatus = "error" | "running" | "waiting" | "idle" | "complete";

export type ConfigField = {
  key: string;
  label: string;
  type: "string" | "boolean" | "number";
  required?: boolean;
  hint?: string;
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

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

export type FlowLevelAction = {
  id: string;
  label: string;
  variant: VisibleAction["variant"];
  createInstance?: { workflowId: string; fields: ConfigField[] };
  dispatchToAll?: { workflowId: string; actionId: string };
};

export type FlowResponse = {
  id: string;
  label: string;
  status: FlowStatus;
  config?: Record<string, unknown>;
  workflows: WorkflowDef[];
  instances: WorkflowInstanceEntry[];
  availableFlowActions: FlowLevelAction[];
};

export type FlowsApiResponse = {
  flows: FlowResponse[];
};

export type FlowDefinitionsApiResponse = {
  definitions: FlowDefinitionSummary[];
};

export type InstancesApiResponse = {
  instances: WorkflowInstanceEntry[];
};

export type DispatchActionResult = {
  instanceId: string;
  previousState: string;
  currentState: string;
  state: WorkflowInstanceState;
  availableActions: VisibleAction[];
};

export type TaskInputResult = {
  sent: boolean;
  instanceId: string;
  runningTaskContext: RunningTaskContext | null;
};

export type FlowWsEvent =
  | {
      type: "flow_state_changed";
      state: Record<string, unknown>;
    }
  | {
      type: "instance_created";
      instanceId: string;
      workflowId: string;
    }
  | {
      type: "instance_state_changed";
      instanceId: string;
      workflowId: string;
      state: WorkflowInstanceState;
    }
  | {
      type: "instance_terminated";
      instanceId: string;
      workflowId: string;
      state: WorkflowInstanceState;
    };

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
  const data = (await res.json()) as FlowDefinitionsApiResponse;
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

// Shared flow-event socket. The app keeps one open for its lifetime instead of
// opening/closing a WebSocket per page — navigating between flow views churns
// the proxy connection otherwise (visible as vite ws proxy EPIPE noise). Pages
// subscribe via connectFlowWs; the socket reopens automatically if it drops
// while at least one page is listening.
let flowWsSocket: WebSocket | null = null;
const flowWsListeners = new Set<(event: FlowWsEvent) => void>();

function openFlowWs(): void {
  const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/api/flows/ws`
  );
  flowWsSocket = socket;

  socket.onmessage = (event) => {
    try {
      // The server only sends FlowRuntimeEvent variants on this WS;
      // malformed frames are silently dropped by the catch.
      const msg = JSON.parse(String(event.data)) as FlowWsEvent;
      for (const listener of flowWsListeners) {
        listener(msg);
      }
    } catch {
      // ignore malformed frames
    }
  };

  socket.onclose = () => {
    if (flowWsSocket !== socket) return;
    flowWsSocket = null;
    if (flowWsListeners.size > 0) {
      setTimeout(openFlowWs, 1_000);
    }
  };
}

export function connectFlowWs(
  onEvent: (event: FlowWsEvent) => void
): () => void {
  flowWsListeners.add(onEvent);
  if (!flowWsSocket) openFlowWs();

  return () => {
    flowWsListeners.delete(onEvent);
  };
}
