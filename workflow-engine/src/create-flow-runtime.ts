import {
  createWorkflowInstanceController,
  type WorkflowInstanceControllerAPI,
} from "./create-workflow-instance-controller";
import { evaluateEdges } from "./evaluate-edges";
import type { RuntimeWorkflowInstanceState } from "./shared/workflow-instance-state";
import type { TaskRunnerFactory } from "./task-runner";
import type {
  ActionVariant,
  RuntimeFlowEdge,
  RuntimeWorkflowConfig,
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
  state: RuntimeWorkflowInstanceState;
  availableActions: VisibleAction[];
};

// ── Persistence interface ──

export type FlowPersistence = {
  saveFlow(flowId: string, config: unknown, state: unknown): void;
  saveInstance(
    flowId: string,
    instanceId: string,
    workflowId: string,
    state: RuntimeWorkflowInstanceState
  ): void;
  saveRunningTaskContext(
    flowId: string,
    instanceId: string,
    context: unknown
  ): void;
  deleteFlow(flowId: string): void;
  loadFlow(flowId: string): {
    config: unknown;
    state: unknown;
    instances: Array<{
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
    }>;
  } | null;
  loadAllFlows(): Array<{
    flowId: string;
    config: unknown;
    state: unknown;
    instances: Array<{
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
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
      state: RuntimeWorkflowInstanceState;
    }
  | {
      type: "instance_terminated";
      instanceId: string;
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
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
    instanceState?: Partial<RuntimeWorkflowInstanceState>
  ): WorkflowInstanceControllerAPI;
  getWorkflowInstance(
    instanceId: string
  ): WorkflowInstanceControllerAPI | undefined;
  workflowInstances: RuntimeWorkflowInstanceState[];
  workflowInstancesInState(stateId?: string): RuntimeWorkflowInstanceState[];
  on(handler: FlowEventHandler): () => void;
  getWorkflowDefinitions(): WorkflowDefResponse[];
  getWorkflowInstanceEntries(): WorkflowInstanceEntry[];
};

// ── Factory ──

export function createFlowRuntime<
  TFlowConfig extends Record<string, unknown> = Record<string, unknown>,
  TFlowState extends Record<string, unknown> = Record<string, unknown>,
>(
  flowId: string,
  workflowDefs: RuntimeWorkflowConfig[],
  edges: RuntimeFlowEdge[],
  runners: Record<string, TaskRunnerFactory>,
  config?: TFlowConfig,
  initialState?: TFlowState,
  persistence?: FlowPersistence
): FlowRuntimeAPI<TFlowConfig, TFlowState> {
  // config/initialState are optional; {} satisfies the Record constraint
  const _flowConfig = (config ?? {}) as TFlowConfig;
  const _flowState = (initialState ?? {}) as TFlowState;
  const controllers = new Map<string, WorkflowInstanceControllerAPI>();
  const instanceWorkflowIds = new Map<string, string>();
  const workflowMap = new Map<string, RuntimeWorkflowConfig>();
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
  ): RuntimeWorkflowInstanceState[] {
    return Array.from(controllers.values())
      .map((c) => c.getState())
      .filter((s) => stateId === undefined || s.currentState === stateId);
  }

  // Cross-instance query for gates and depends-on checks. Unlike the public
  // workflowInstancesInState, this carries each instance's id so callers can
  // reference specific instances.
  function _controllerInstancesInState(
    stateId?: string
  ): { currentState: string; id: string }[] {
    return Array.from(controllers.entries())
      .map(([id, ctrl]) => ({ id, currentState: ctrl.getState().currentState }))
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
      state: _flowState,
    });
    persistence?.saveFlow(flowId, _flowConfig, _flowState);
  }

  function evaluateEdgesOnTerminal(
    workflowId: string,
    instanceState: RuntimeWorkflowInstanceState
  ): void {
    const effects = evaluateEdges(
      edges,
      workflowId,
      instanceState.currentState,
      instanceState.taskOutputs
    );

    for (const effect of effects) {
      if (effect.toFlowState) {
        // Edge transform output is expected to be flow-state-shaped
        patchFlowState(effect.transformedData as Partial<TFlowState>);
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
    instanceState?: Partial<RuntimeWorkflowInstanceState>
  ): WorkflowInstanceControllerAPI {
    const workflow = workflowMap.get(workflowId);
    if (!workflow) throw new Error(`Workflow "${workflowId}" not found`);

    const instanceId = crypto.randomUUID();

    const initialState: RuntimeWorkflowInstanceState = {
      currentState: instanceState?.currentState ?? workflow.initial,
      taskOutputs: instanceState?.taskOutputs ?? {},
      hasRunningTask: instanceState?.hasRunningTask ?? false,
      runningTaskId: instanceState?.runningTaskId ?? null,
      runningTaskContext: instanceState?.runningTaskContext ?? null,
      workflowInstanceState: instanceState?.workflowInstanceState ?? {},
      history: instanceState?.history ?? [],
    };

    const controller = createWorkflowInstanceController(
      workflow,
      runners,
      initialState,
      _controllerInstancesInState,
      _flowState,
      {
        flowConfig: _flowConfig,
        patchFlowConfig,
        instanceId,
        workflowId,
      }
    );

    controllers.set(instanceId, controller);
    instanceWorkflowIds.set(instanceId, workflowId);

    // Persist the initial state so freshly-created instances (including
    // seeds) survive a restart, not just ones that later changed state.
    persistence?.saveInstance(flowId, instanceId, workflowId, initialState);

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

    // A freshly created instance (no restored taskOutputs) auto-runs its
    // initial-state auto tasks — e.g. the onboarding workflow validates the
    // repo, and edge-created cards register on the board. Rehydrated
    // instances (restored taskOutputs) are resumed explicitly by the caller.
    if (instanceState?.taskOutputs === undefined) {
      void controller.startAutoTasks();
    }

    return controller;
  }

  return {
    getFlowConfig: () => _flowConfig,
    getFlowState: () => _flowState,
    patchFlowConfig,
    patchFlowState,
    addWorkflowInstance,
    getWorkflowInstance: (instanceId: string) => controllers.get(instanceId),
    get workflowInstances(): RuntimeWorkflowInstanceState[] {
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
