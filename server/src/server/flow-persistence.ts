/** @public — filesystem-backed FlowPersistence using ~/.hive/flows/ */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HIVE_DIR } from "shared/hive-dir";
import type { FlowPersistence } from "workflow-engine/create-flow-runtime";
import type { WorkflowInstanceState } from "workflow-engine/shared/workflow-instance-state";

const DEFAULT_FLOWS_DIR = join(HIVE_DIR, "flows");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function atomicWrite(filePath: string, data: unknown): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, filePath);
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

type PersistedFlow = {
  config: Record<string, unknown>;
  state: Record<string, unknown>;
};

type PersistedInstance = {
  workflowId: string;
  state: WorkflowInstanceState<any, any, any>;
};

export function createFlowPersistence(
  flowsDir: string = DEFAULT_FLOWS_DIR
): FlowPersistence {
  function flowDir(flowId: string): string {
    return join(flowsDir, encodeURIComponent(flowId));
  }

  function flowFilePath(flowId: string): string {
    return join(flowDir(flowId), "flow.json");
  }

  function instancesDir(flowId: string): string {
    return join(flowDir(flowId), "instances");
  }

  function instanceFilePath(flowId: string, instanceId: string): string {
    return join(instancesDir(flowId), `${encodeURIComponent(instanceId)}.json`);
  }

  function contextFilePath(flowId: string, instanceId: string): string {
    return join(
      instancesDir(flowId),
      `${encodeURIComponent(instanceId)}.ctx.json`
    );
  }

  function listInstanceIds(flowId: string): string[] {
    const dir = instancesDir(flowId);
    try {
      const entries = readdirSync(dir);
      const seen = new Set<string>();
      for (const name of entries) {
        const match = name.match(/^(.+?)\.(?:json|ctx\.json)$/);
        if (match) seen.add(match[1]!);
      }
      return Array.from(seen);
    } catch {
      return [];
    }
  }

  function saveFlow(flowId: string, config: unknown, state: unknown): void {
    atomicWrite(flowFilePath(flowId), {
      config: isRecord(config) ? config : {},
      state: isRecord(state) ? state : {},
    } satisfies PersistedFlow);
  }

  function saveInstance(
    flowId: string,
    instanceId: string,
    workflowId: string,
    state: WorkflowInstanceState<any, any, any>
  ): void {
    atomicWrite(instanceFilePath(flowId, instanceId), {
      workflowId,
      state,
    } satisfies PersistedInstance);
  }

  function saveRunningTaskContext(
    flowId: string,
    instanceId: string,
    context: unknown
  ): void {
    atomicWrite(contextFilePath(flowId, instanceId), context);
  }

  function loadFlow(flowId: string): {
    config: unknown;
    state: unknown;
    instances: Array<{
      workflowId: string;
      state: WorkflowInstanceState<any, any, any>;
    }>;
  } | null {
    const flow = readJson<PersistedFlow>(flowFilePath(flowId));
    if (!flow) return null;

    const ids = listInstanceIds(flowId);
    const instances: Array<{
      workflowId: string;
      state: WorkflowInstanceState<any, any, any>;
    }> = [];

    for (const id of ids) {
      const persisted = readJson<PersistedInstance>(
        instanceFilePath(flowId, id)
      );
      if (!persisted) continue;

      const ctx = readJson<Record<string, unknown>>(
        contextFilePath(flowId, id)
      );

      instances.push({
        workflowId: persisted.workflowId,
        state: {
          ...persisted.state,
          runningTaskContext: ctx
            ? ({ ...persisted.state.runningTaskContext, ...ctx } as any)
            : persisted.state.runningTaskContext,
        },
      });
    }

    return { config: flow.config, state: flow.state, instances };
  }

  function loadAllFlows(): Array<{
    flowId: string;
    config: unknown;
    state: unknown;
    instances: Array<{
      workflowId: string;
      state: WorkflowInstanceState<any, any, any>;
    }>;
  }> {
    try {
      return readdirSync(flowsDir)
        .filter((name) => {
          const fullPath = join(flowsDir, name);
          try {
            return existsSync(join(fullPath, "flow.json"));
          } catch {
            return false;
          }
        })
        .map((name) => ({
          flowId: decodeURIComponent(name),
          ...loadFlow(decodeURIComponent(name))!,
        }));
    } catch {
      return [];
    }
  }

  return {
    saveFlow,
    saveInstance,
    saveRunningTaskContext,
    loadFlow,
    loadAllFlows,
  };
}
