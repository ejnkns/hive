/** @private — only imported by runners.ts */
import type {
  TaskDefinition,
  TaskRunner,
  WorkflowInstancesInState,
} from "../task-runner.ts";

// Operations are deterministic engine tasks. They receive the flow's runtime
// context so they can read and patch flow config, and the identity and state
// of the workflow instance the task runs in (e.g. prepare_worktree derives the
// card id and attempt from the instance). The context is built by the runner
// factory from the per-task TaskRunnerContext; a no-op default keeps direct
// runner construction safe.
//
// TState is the workflow's declared state type. At the engine boundary it is
// erased to Record<string, unknown> (the wire model); a preset author binds
// the type once per operations group via defineOperations<TState> — the
// single, hidden erasure point — so every op body is type-checked against the
// workflow's state. Engine infrastructure ops (prepare_worktree, ...) serve
// any workflow and use the erased context directly.
export type OperationContext<
  TState extends Record<string, unknown> = Record<string, unknown>,
> = {
  flowConfig(): Record<string, unknown>;
  instanceId: string;
  workflowId: string;
  currentState: string;
  workflowInstanceState(): TState;
  // Completed task outputs on the instance (read-only), so operations can read
  // sibling tasks' results.
  taskOutputs(): Record<string, unknown>;
  // Patches the workflow instance's domain data. Ops use this to record
  // per-instance state (e.g. the worktree a card's worker operates in);
  // the engine persists it as part of the instance. Typed as Partial<TState>
  // so a patch can only write declared fields.
  patchWorkflowInstanceState(patch: Partial<TState>): void;
  // Flow-level state access (E2): the flow's declared cross-entity state
  // (e.g. the shared taxonomy in honeycomb). Live reads see the current
  // state; patchFlowState mirrors the flowState write — the write persists and
  // emits flow_state_changed.
  flowState(): Record<string, unknown>;
  patchFlowState(patch: Record<string, unknown>): void;
  // Queries workflow instances. Pass a state id (legacy) or a
  // { workflowId?, stateId? } filter; every projection carries the instance's
  // workflowId so an op can tell sibling workflows apart (E6).
  workflowInstancesInState: WorkflowInstancesInState;
  // Cross-instance write (E1): patches a sibling instance's declared state
  // from this operation. Same-flow only. Returns false for an unknown
  // instance id (a NOOP — the op decides, e.g. a stale title reference);
  // throws when the patch carries a field the target workflow's
  // instanceState does not declare.
  patchInstanceState(
    instanceId: string,
    patch: Record<string, unknown>
  ): boolean;
};

export type OperationFn<
  TState extends Record<string, unknown> = Record<string, unknown>,
> = (
  task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext<TState>
) => unknown | Promise<unknown>;

export type OperationRunnerConfig = {
  operations: Record<string, OperationFn>;
  getContext?: () => OperationContext;
};

// The consumer-facing factory for a workflow's operations. Binds the workflow's
// state type once per group — `defineOperations<CardsItemState>({ ... })` with
// the type imported from the workflow module — so every op body is
// type-checked against it (typed reads and Partial<TState> patches, no casts),
// then erases for the shared name-resolved registry in one hidden cast here.
export function defineOperations<TState extends Record<string, unknown>>(
  operations: Record<string, OperationFn<TState>>
): Record<string, OperationFn> {
  // The engine resolves operations by name across all workflows and can't
  // know each group's state type; the author bound it above, so this is the
  // group's single erasure point.
  return operations as unknown as Record<string, OperationFn>;
}

const NOOP_CONTEXT: OperationContext = {
  flowConfig: () => ({}),
  instanceId: "",
  workflowId: "",
  currentState: "",
  workflowInstanceState: () => ({}),
  taskOutputs: () => ({}),
  patchWorkflowInstanceState: () => {},
  flowState: () => ({}),
  patchFlowState: () => {},
  workflowInstancesInState: () => [],
  patchInstanceState: () => false,
};

export function createOperationRunner(
  config: OperationRunnerConfig
): TaskRunner {
  let cancelled = false;
  const getContext = config.getContext ?? (() => NOOP_CONTEXT);

  return {
    async run(task: TaskDefinition) {
      const ops = task.operations ?? [];
      const outputs: Record<string, unknown> = {};
      const params = task.operationInputs ?? {};

      for (const opName of ops) {
        if (cancelled) break;
        const fn = config.operations[opName];
        if (!fn) {
          throw new Error(`Unknown operation: ${opName}`);
        }
        const result = await fn(task, params, getContext());

        // A single-operation task's output IS the operation result — gates
        // check it directly (e.g. output.ok). Multi-operation tasks key each
        // result by operation name so gates can tell them apart.
        if (ops.length === 1) return { output: result };

        outputs[opName] = result;
      }

      return { output: outputs };
    },

    cancel() {
      cancelled = true;
    },
  };
}
