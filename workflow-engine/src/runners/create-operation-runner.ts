/** @private — only imported by runners.ts */
import type { TaskDefinition, TaskRunner } from "../task-runner";

// Operations are deterministic engine tasks. They receive the flow's runtime
// context so they can read and patch flow config, and the identity and state
// of the workflow instance the task runs in (e.g. prepare_worktree derives the
// card id and attempt from the instance). The context is built by the runner
// factory from the per-task TaskRunnerContext; a no-op default keeps direct
// runner construction safe.
export type OperationContext = {
  flowConfig(): Record<string, unknown>;
  patchFlowConfig(patch: Record<string, unknown>): void;
  instanceId: string;
  workflowId: string;
  currentState: string;
  workflowInstanceState(): Record<string, unknown>;
};

export type OperationFn = (
  task: TaskDefinition,
  params: Record<string, unknown>,
  ctx: OperationContext
) => unknown | Promise<unknown>;

export type OperationRunnerConfig = {
  operations: Record<string, OperationFn>;
  getContext?: () => OperationContext;
};

const NOOP_CONTEXT: OperationContext = {
  flowConfig: () => ({}),
  patchFlowConfig: () => {},
  instanceId: "",
  workflowId: "",
  currentState: "",
  workflowInstanceState: () => ({}),
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
