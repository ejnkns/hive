import {
  createWorkflowInstanceController,
  type WorkflowConfig,
  type WorkflowInstanceControllerAPI,
} from "./create-workflow-instance-controller";
import { evaluateEdges } from "./evaluate-edges";
import type { WorkflowInstanceState } from "./shared/workflow-instance-state";
import type { TaskRunner } from "./task-runner";
import type {
  ActionVariant,
  FlowEdge,
  StateCategory,
  VisibleAction,
} from "./workflow-types";

// ── API response types ──

export type WorkflowDefResponse = {
  id: string;
  label: string;
  description?: string;
  states: Array<{
    id: string;
    label: string;
    description?: string;
    category?: StateCategory;
    actions: Array<{ id: string; label: string; variant: ActionVariant }>;
  }>;
  initial: string;
  terminalStates: string[];
};

export type WorkflowInstanceEntry = {
  id: string;
  workflowId: string;
  state: WorkflowInstanceState<any, any, any>;
  availableActions: VisibleAction[];
};

// ── Persistence interface (stub — Ticket 6 implements) ──

export type FlowPersistence = {
  saveFlow(flowId: string, config: unknown, state: unknown): void;
  saveInstance(
    flowId: string,
    instanceId: string,
    workflowId: string,
    state: WorkflowInstanceState<any, any, any>
  ): void;
  saveRunningTaskContext(
    flowId: string,
    instanceId: string,
    context: unknown
  ): void;
  loadFlow(flowId: string): {
    config: unknown;
    state: unknown;
    instances: Array<{
      workflowId: string;
      state: WorkflowInstanceState<any, any, any>;
    }>;
  } | null;
  loadAllFlows(): Array<{
    flowId: string;
    config: unknown;
    state: unknown;
    instances: Array<{
      workflowId: string;
      state: WorkflowInstanceState<any, any, any>;
    }>;
  }>;
};

// ── Flow-level events ──

export type FlowRuntimeEvent =
  | { type: "flow_state_changed"; state: Record<string, unknown> }
  | { type: "instance_created"; instanceId: string; workflowId: string }
  | {
      type: "instance_state_changed";
      instanceId: string;
      workflowId: string;
      state: WorkflowInstanceState<any, any, any>;
    }
  | {
      type: "instance_terminated";
      instanceId: string;
      workflowId: string;
      state: WorkflowInstanceState<any, any, any>;
    };

export type FlowEventHandler = (event: FlowRuntimeEvent) => void;

// ── Public API ──

export type FlowRuntimeAPI<TFlowConfig, TFlowState> = {
  getFlowConfig(): TFlowConfig;
  getFlowState(): TFlowState;
  patchFlowConfig(patch: Partial<TFlowConfig>): void;
  patchFlowState(patch: Partial<TFlowState>): void;
  addWorkflowInstance(
    workflowId: string,
    instanceState?: Partial<WorkflowInstanceState<any, any, any>>
  ): WorkflowInstanceControllerAPI<any, any, any>;
  getWorkflowInstance(
    instanceId: string
  ): WorkflowInstanceControllerAPI<any, any, any> | undefined;
  workflowInstances: WorkflowInstanceState<any, any, any>[];
  workflowInstancesInState(
    stateId?: string
  ): WorkflowInstanceState<any, any, any>[];
  on(handler: FlowEventHandler): () => void;
  getWorkflowDefinitions(): WorkflowDefResponse[];
  getWorkflowInstanceEntries(): WorkflowInstanceEntry[];
};

// ── Factory ──

export function createFlowRuntime<
  TFlowConfig extends Record<string, unknown> = Record<string, never>,
  TFlowState extends Record<string, unknown> = Record<string, never>,
>(
  flowId: string,
  workflowDefs: WorkflowConfig<any, any, any>[],
  edges: FlowEdge[],
  runners: Record<string, TaskRunner>,
  config?: TFlowConfig,
  initialState?: TFlowState,
  persistence?: FlowPersistence
): FlowRuntimeAPI<TFlowConfig, TFlowState> {
  const _flowConfig = (config ?? {}) as TFlowConfig;
  const _flowState = (initialState ?? {}) as TFlowState;
  const controllers = new Map<
    string,
    WorkflowInstanceControllerAPI<any, any, any>
  >();
  const instanceWorkflowIds = new Map<string, string>();
  const workflowMap = new Map<string, WorkflowConfig<any, any, any>>();
  const eventHandlers = new Set<FlowEventHandler>();

  for (const wf of workflowDefs) {
    workflowMap.set(wf.id, wf);
  }

  // ── internal helpers ──

  function emit(event: FlowRuntimeEvent): void {
    for (const handler of eventHandlers) {
      handler(event);
    }
  }

  function _workflowInstancesInState(
    stateId?: string
  ): WorkflowInstanceState<any, any, any>[] {
    return Array.from(controllers.values())
      .map((c) => c.getState())
      .filter((s) => stateId === undefined || s.currentState === stateId);
  }

  function patchFlowConfig(patch: Partial<TFlowConfig>): void {
    Object.assign(_flowConfig, patch);
    persistence?.saveFlow(flowId, _flowConfig, _flowState);
  }

  function patchFlowState(patch: Partial<TFlowState>): void {
    Object.assign(_flowState, patch);
    emit({
      type: "flow_state_changed",
      state: _flowState as unknown as Record<string, unknown>,
    });
    persistence?.saveFlow(flowId, _flowConfig, _flowState);
  }

  function evaluateEdgesOnTerminal(
    workflowId: string,
    instanceState: WorkflowInstanceState<any, any, any>
  ): void {
    const effects = evaluateEdges(
      edges,
      workflowId,
      instanceState.currentState,
      instanceState.taskOutputs as unknown as Record<string, unknown>
    );

    for (const effect of effects) {
      if (effect.toFlowState) {
        patchFlowState(
          effect.transformedData as unknown as Partial<TFlowState>
        );
      }
      if (effect.toWorkflow) {
        addWorkflowInstance(effect.toWorkflow, {
          workflowInstanceState: effect.transformedData,
        });
      }
    }
  }

  // ── public methods ──

  function getWorkflowDefinitions(): WorkflowDefResponse[] {
    return Array.from(workflowMap.values()).map((wf) => ({
      id: wf.id,
      label: wf.label,
      description: wf.description,
      states: wf.states.map((s) => ({
        id: s.id,
        label: s.label,
        description: s.description,
        category: s.category,
        actions: s.actions
          ? s.actions.map((a) => ({
              id: a.id,
              label: a.label,
              variant: a.variant ?? "default",
            }))
          : [],
      })),
      initial: wf.initial,
      terminalStates: [...wf.terminalStates],
    }));
  }

  function getWorkflowInstanceEntries(): WorkflowInstanceEntry[] {
    return Array.from(controllers.entries()).map(([id, ctrl]) => ({
      id,
      workflowId: instanceWorkflowIds.get(id) ?? "",
      state: ctrl.getState(),
      availableActions: ctrl.getAvailableActions(),
    }));
  }

  function addWorkflowInstance(
    workflowId: string,
    instanceState?: Partial<WorkflowInstanceState<any, any, any>>
  ): WorkflowInstanceControllerAPI<any, any, any> {
    const workflow = workflowMap.get(workflowId);
    if (!workflow) throw new Error(`Workflow "${workflowId}" not found`);

    const instanceId = crypto.randomUUID();

    const initialState: WorkflowInstanceState<any, any, any> = {
      currentState: instanceState?.currentState ?? workflow.initial,
      taskOutputs: instanceState?.taskOutputs ?? {},
      hasRunningTask: instanceState?.hasRunningTask ?? false,
      runningTaskId: instanceState?.runningTaskId ?? null,
      runningTaskContext: instanceState?.runningTaskContext ?? null,
      workflowInstanceState: instanceState?.workflowInstanceState ?? {},
      history: instanceState?.history ?? [],
    };

    const controller = createWorkflowInstanceController(
      workflow as any,
      runners,
      initialState as any,
      _workflowInstancesInState,
      _flowState as any
    );

    controllers.set(instanceId, controller);
    instanceWorkflowIds.set(instanceId, workflowId);

    controller.on((event) => {
      if (event.type === "state_changed") {
        emit({
          type: "instance_state_changed",
          instanceId,
          workflowId,
          state: event.state,
        });

        persistence?.saveInstance(flowId, instanceId, workflowId, event.state);

        if (workflow.terminalStates.includes(event.state.currentState)) {
          emit({
            type: "instance_terminated",
            instanceId,
            workflowId,
            state: event.state,
          });
          evaluateEdgesOnTerminal(workflowId, event.state);
        }
      }
    });

    emit({ type: "instance_created", instanceId, workflowId });

    return controller;
  }

  return {
    getFlowConfig: () => _flowConfig,
    getFlowState: () => _flowState,
    patchFlowConfig,
    patchFlowState,
    addWorkflowInstance,
    getWorkflowInstance: (instanceId: string) => controllers.get(instanceId),
    get workflowInstances(): WorkflowInstanceState<any, any, any>[] {
      return Array.from(controllers.values()).map((c) => c.getState());
    },
    workflowInstancesInState: _workflowInstancesInState,
    on: (handler: FlowEventHandler) => {
      eventHandlers.add(handler);
      return () => {
        eventHandlers.delete(handler);
      };
    },
    getWorkflowDefinitions,
    getWorkflowInstanceEntries,
  };
}
