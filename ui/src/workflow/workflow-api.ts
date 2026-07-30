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

export type FlowResponse = {
  id: string;
  label: string;
  workflows: WorkflowDef[];
  instances: WorkflowInstanceEntry[];
};

export type FlowsApiResponse = {
  flows: FlowResponse[];
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

export async function fetchFlows(): Promise<FlowResponse[]> {
  const res = await fetch("/api/flows");
  if (!res.ok) throw new Error(`Failed to fetch flows: ${res.statusText}`);
  const data = (await res.json()) as FlowsApiResponse;
  return data.flows;
}

export async function fetchFlowInstances(
  flowId: string
): Promise<WorkflowInstanceEntry[]> {
  const res = await fetch(`/api/flows/${encodeURIComponent(flowId)}/instances`);
  if (!res.ok) throw new Error(`Failed to fetch instances: ${res.statusText}`);
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
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? `Action rejected: ${res.statusText}`);
  }

  return (await res.json()) as DispatchActionResult;
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
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? `Failed to send input: ${res.statusText}`);
  }

  return (await res.json()) as TaskInputResult;
}

export function connectFlowWs(
  onEvent: (event: FlowWsEvent) => void
): () => void {
  const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/api/flows/ws`
  );
  let closed = false;

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data)) as FlowWsEvent;
      onEvent(msg);
    } catch {
      // ignore malformed frames
    }
  };

  socket.onclose = () => {
    closed = true;
  };

  return () => {
    if (!closed) socket.close();
  };
}
