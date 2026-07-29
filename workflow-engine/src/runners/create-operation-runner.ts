/** @private — only imported by runners.ts */
import type { TaskDefinition, TaskRunner } from "../task-runner";

export type OperationFn = (
  task: TaskDefinition,
  params: Record<string, unknown>
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export type OperationRunnerConfig = {
  operations: Record<string, OperationFn>;
};

export function createOperationRunner(
  config: OperationRunnerConfig
): TaskRunner {
  let cancelled = false;

  return {
    async run(task: TaskDefinition) {
      const ops = task.operations ?? [];
      const outputs: Record<string, unknown> = {};

      for (const opName of ops) {
        if (cancelled) break;
        const fn = config.operations[opName];
        if (!fn) {
          throw new Error(`Unknown operation: ${opName}`);
        }
        outputs[opName] = await fn(task, {});
      }

      return { output: outputs };
    },

    cancel() {
      cancelled = true;
    },
  };
}
