/** @public — the flow runtime factory and its API surface. Import from here, not from create-flow-runtime/ directly. */

import type { FlowPersistence } from "./create-flow-runtime/flow-persistence.ts";
import type { FlowRuntimeAPI } from "./create-flow-runtime/flow-runtime-api.ts";
import type {
  FlowEventHandler,
  FlowRuntimeEvent,
} from "./create-flow-runtime/flow-runtime-events.ts";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "./create-flow-runtime/response-types.ts";
import {
  createWorkflowInstanceController,
  type WorkflowInstanceControllerAPI,
} from "./create-workflow-instance-controller.ts";
import { summarizeWorkflowInstances } from "./derive-display.ts";
import { evaluateEdges } from "./evaluate-edges.ts";
import { evaluateGate } from "./evaluate-gate.ts";
import type { RuntimeWorkflowInstanceState } from "./shared/workflow-instance-state.ts";
import type {
  TaskRunnerFactory,
  WorkflowInstanceProjection,
} from "./task-runner.ts";
import type {
  ConfigField,
  RuntimeFlowEdge,
  RuntimeWorkflowConfig,
  WorkflowSummary,
} from "./workflow-types.ts";

export type {
  FlowEventHandler,
  FlowPersistence,
  FlowRuntimeAPI,
  FlowRuntimeEvent,
  WorkflowDefResponse,
  WorkflowInstanceEntry,
  WorkflowSummary,
};
export { evaluateGate };

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

  // Cross-instance query for gates and depends-on checks. Filter by workflow
  // id and/or state id; every projection carries the instance's workflowId so
  // callers can tell sibling workflows apart.
  function workflowInstancesInState(
    workflowId?: string,
    stateId?: string
  ): WorkflowInstanceProjection[] {
    return Array.from(controllers.entries())
      .map(([id, ctrl]) => ({
        id,
        workflowId: instanceWorkflowIds.get(id) ?? "",
        currentState: ctrl.getState().currentState,
        workflowInstanceState: ctrl.getState().workflowInstanceState,
      }))
      .filter(
        (s) =>
          (workflowId === undefined || s.workflowId === workflowId) &&
          (stateId === undefined || s.currentState === stateId)
      );
  }

  // Cross-instance write (E1): patches a sibling instance's state from an
  // operation running on another instance of the same flow. Unknown id →
  // false (a NOOP the op handles); undeclared patch keys (against the target
  // workflow's instanceState) throw so the op errors into the flow's
  // needs-review state instead of silently writing an undeclared field. The
  // write goes through the target controller's patch path, so it emits
  // instance_state_changed and persists exactly like an own-instance patch.
  function patchSiblingInstanceState(
    instanceId: string,
    patch: Record<string, unknown>
  ): boolean {
    const controller = controllers.get(instanceId);
    if (!controller) return false;
    const workflowId = instanceWorkflowIds.get(instanceId);
    const declaredFields = workflowId
      ? (workflowMap.get(workflowId)?.instanceState ?? []).map(
          (field) => field.field
        )
      : [];
    if (declaredFields.length > 0) {
      const declared = new Set(declaredFields);
      for (const key of Object.keys(patch)) {
        if (!declared.has(key)) {
          throw new Error(
            `sibling patch writes "${key}" which is not declared in workflow "${workflowId}" instanceState (declared: ${[...declared].join(", ")})`
          );
        }
      }
    }
    controller.patchWorkflowInstanceState(patch);
    return true;
  }

  // Instance removal (E5): drops the controller from the runtime maps, cancels
  // any running task, deletes the persisted state, and notifies listeners so
  // the snapshot push excludes the removed instance. Unknown id → false (a
  // NOOP). References that pointed at the removed instance (title-based
  // dependsOn entries) resolve to nothing and go stale gracefully — the
  // depends-on gates treat a missing id as an unmet dependency, never an
  // error.
  function removeWorkflowInstance(instanceId: string): boolean {
    const controller = controllers.get(instanceId);
    if (!controller) return false;
    const workflowId = instanceWorkflowIds.get(instanceId) ?? "";
    controller.cancel();
    controllers.delete(instanceId);
    instanceWorkflowIds.delete(instanceId);
    emit({ type: "instance_removed", instanceId, workflowId });
    persistence?.deleteInstance?.(flowId, instanceId);
    return true;
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

    // Collect newly created instance IDs per target workflow so we can
    // resolve name-based dependencies after all fan-out instances exist.
    const newInstances = new Map<string, string[]>();

    for (const effect of effects) {
      if (effect.toFlowState) {
        // Edge transform output is expected to be flow-state-shaped
        patchFlowState(effect.transformedData as Partial<TFlowState>);
      }
      if (effect.toWorkflow) {
        if (effect.autoDispatch) {
          // autoDispatch: the declarative singleton-refresh primitive. With
          // createIfNone, create the target instance first when none exists
          // (the edge's transformed data seeds its state; its initial-state
          // auto-tasks run). Then dispatch the action to EVERY instance of the
          // target workflow through the same availability path as a manual
          // click — an instance where the action is unavailable (wrong state
          // or a failing gate) is a silent no-op. Edge effects apply in
          // declaration order, so a fan-out edge declared before this one has
          // already created the cards this refresh reads.
          if (
            effect.autoDispatch.createIfNone === true &&
            workflowInstancesInState(effect.toWorkflow).length === 0
          ) {
            addWorkflowInstance(effect.toWorkflow, {
              workflowInstanceState: effect.transformedData,
            });
          }
          for (const instance of workflowInstancesInState(effect.toWorkflow)) {
            controllers
              .get(instance.id)
              ?.dispatchAction(effect.autoDispatch.actionId);
          }
          continue;
        }
        const beforeIds = new Set(
          Array.from(controllers.keys()).filter(
            (id) => instanceWorkflowIds.get(id) === effect.toWorkflow
          )
        );
        addWorkflowInstance(effect.toWorkflow, {
          workflowInstanceState: effect.transformedData,
        });
        for (const [id, wfId] of instanceWorkflowIds) {
          if (wfId === effect.toWorkflow && !beforeIds.has(id)) {
            const list = newInstances.get(effect.toWorkflow) ?? [];
            list.push(id);
            newInstances.set(effect.toWorkflow, list);
          }
        }
      }
    }

    // Resolve name-based dependencies after all fan-out instances exist.
    for (const [wfId, ids] of newInstances) {
      for (const id of ids) {
        resolveDependsOnNames(id, wfId);
      }
    }
  }

  // After an edge creates a workflow instance, resolves any name-based
  // `dependsOn` entries to instance IDs so the engine's `dependsOnState`
  // gate (which compares against IDs) works correctly. The workflow's
  // `instance.title` path defines the name each instance is known by.
  function resolveDependsOnNames(instanceId: string, workflowId: string): void {
    const controller = controllers.get(instanceId);
    if (!controller) return;
    const state = controller.getState();
    const deps = readDependsOn(state.workflowInstanceState);
    if (deps.length === 0) return;

    const workflow = workflowMap.get(workflowId);
    if (!workflow?.instance?.title) return;
    const titlePath = workflow.instance.title;

    // Build a title→id map from all instances of this workflow.
    const titleToId = new Map<string, string>();
    for (const [id, ctrl] of controllers) {
      if (instanceWorkflowIds.get(id) !== workflowId) continue;
      const title = resolvePath(
        ctrl.getState().workflowInstanceState,
        titlePath
      );
      if (typeof title === "string" && title !== "") {
        titleToId.set(title, id);
      }
    }

    // Resolve each dependency name to its instance ID. Unmatched names are
    // dropped — they reference something that doesn't exist (yet).
    const resolved = deps
      .map((name) => titleToId.get(name))
      .filter((id): id is string => id !== undefined);

    // Only patch if something changed (avoid unnecessary persistence writes).
    const current = readDependsOn(state.workflowInstanceState);
    if (
      resolved.length !== current.length ||
      !resolved.every((id, i) => id === current[i])
    ) {
      controller.patchWorkflowInstanceState({
        ...state.workflowInstanceState,
        dependsOn: resolved,
      });
    }
  }

  // Resolves a dotted path into an object, returning undefined for missing
  // segments. Mirrors the UI-side resolvePath for engine-side use.
  function resolvePath(obj: Record<string, unknown>, path: string): unknown {
    if (path === "") return obj;
    const segments = path.split(".");
    let current: unknown = obj;
    for (const segment of segments) {
      if (current === null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  // ── public methods ──

  function getWorkflowDefinitions(): WorkflowDefResponse[] {
    return Array.from(workflowMap.values()).map((wf) => ({
      id: wf.id,
      label: wf.label,
      description: wf.description,
      instance: wf.instance,
      display: wf.display,
      ui: wf.ui,
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
        tasks: s.tasks?.map((t) => ({
          id: t.id,
          label: t.label,
          role: t.role,
          ...(t.render !== undefined ? { render: t.render } : {}),
        })),
      })),
      initial: wf.initial,
      terminalStates: [...wf.terminalStates],
    }));
  }

  // E4: a declared edit field's dynamic options (optionsFrom) resolve from
  // flowState when serializing instance entries — the category taxonomy the
  // human edits against. When flowState lacks the value, the field falls
  // back to free text (no options); the declared source is dropped from the
  // wire shape so the UI renders a plain input.
  function resolveEditFieldOptions(field: ConfigField): ConfigField {
    if (field.optionsFrom === undefined) return field;
    const source = field.optionsFrom.flowState;
    const value = resolvePath(_flowState, source);
    const options = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
    if (options.length === 0) {
      const { optionsFrom: _dropped, ...rest } = field;
      return rest;
    }
    const { optionsFrom: _dropped, ...rest } = field;
    return { ...rest, options };
  }

  function getWorkflowInstanceEntries(): WorkflowInstanceEntry[] {
    const entries = Array.from(controllers.entries()).map(([id, ctrl]) => {
      const workflowId = instanceWorkflowIds.get(id) ?? "";
      return {
        id,
        workflowId,
        state: ctrl.getState(),
        availableActions: ctrl.getAvailableActions(),
        editFields: (workflowMap.get(workflowId)?.editFields ?? []).map(
          resolveEditFieldOptions
        ),
        // Filled below once every entry is known.
        workflowSummary: { total: 0, byField: {} },
      };
    });
    // Per-workflow aggregates: every entry of a workflow carries the same
    // summary of that workflow's instances.
    const byWorkflow = new Map<string, WorkflowSummary>();
    for (const entry of entries) {
      const existing = byWorkflow.get(entry.workflowId);
      if (existing !== undefined) {
        entry.workflowSummary = existing;
        continue;
      }
      const summary = summarizeWorkflowInstances(
        entries
          .filter((e) => e.workflowId === entry.workflowId)
          .map((e) => ({
            workflowInstanceState: e.state.workflowInstanceState,
          }))
      );
      byWorkflow.set(entry.workflowId, summary);
      entry.workflowSummary = summary;
    }
    return entries;
  }

  function addWorkflowInstance(
    workflowId: string,
    instanceState?: Partial<RuntimeWorkflowInstanceState>,
    restoreId?: string
  ): WorkflowInstanceControllerAPI {
    const workflow = workflowMap.get(workflowId);
    if (!workflow) throw new Error(`Workflow "${workflowId}" not found`);

    const instanceId = restoreId ?? crypto.randomUUID();

    // An explicit starting state must be one the workflow declares — an
    // unknown stateId is an authoring/runtime error, not a silent default.
    if (instanceState?.currentState !== undefined) {
      const declaredStates = new Set(workflow.states.map((state) => state.id));
      if (!declaredStates.has(instanceState.currentState)) {
        throw new Error(
          `Workflow "${workflowId}" has no state "${instanceState.currentState}" to start an instance in`
        );
      }
    }

    const initialState: RuntimeWorkflowInstanceState = {
      currentState: instanceState?.currentState ?? workflow.initial,
      taskOutputs: instanceState?.taskOutputs ?? {},
      hasRunningTask: instanceState?.hasRunningTask ?? false,
      runningTaskId: instanceState?.runningTaskId ?? null,
      runningTaskContext: instanceState?.runningTaskContext ?? null,
      workflowInstanceState: instanceState?.workflowInstanceState ?? {},
      history: instanceState?.history ?? [],
      taskErrorCounts: instanceState?.taskErrorCounts ?? {},
    };

    const controller = createWorkflowInstanceController(
      workflow,
      runners,
      initialState,
      workflowInstancesInState,
      _flowState,
      {
        flowConfig: _flowConfig,
        patchFlowConfig,
        instanceId,
        workflowId,
        // Expose instance creation to agents via the create_instance tool: the
        // caller's domain state becomes the new instance's workflowInstanceState.
        createWorkflowInstance: (newWorkflowId, domainState, stateId) => {
          const created = addWorkflowInstance(newWorkflowId, {
            ...(stateId !== undefined ? { currentState: stateId } : {}),
            workflowInstanceState: domainState ?? {},
          });
          return { id: created.id };
        },
        patchSiblingInstanceState,
        // E5: a deletesInstance action on this instance removes it from the
        // flow (the controller calls back into the runtime).
        removeInstance: () => removeWorkflowInstance(instanceId),
        // E2: flow-level state access — the live state object (mutated in
        // place by patchFlowState so gates/ops see updates) plus the write
        // (persists + emits flow_state_changed).
        flowState: () => _flowState,
        patchFlowState: (patch: Record<string, unknown>) =>
          patchFlowState(patch as Partial<TFlowState>),
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
    workflowInstancesInState,
    on: (handler: FlowEventHandler) => {
      eventHandlers.add(handler);
      return () => {
        eventHandlers.delete(handler);
      };
    },
    removeWorkflowInstance,
    getWorkflowDefinitions,
    getWorkflowInstanceEntries,
  };
}

// Reads `dependsOn` from a workflow instance's domain state. Returns an array
// of strings (names or IDs). Used by the dependency-resolution step after edge
// fan-out and by the `dependsOnState` gate in dispatchAction.
function readDependsOn(instanceState: Record<string, unknown>): string[] {
  const raw = instanceState.dependsOn;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}
