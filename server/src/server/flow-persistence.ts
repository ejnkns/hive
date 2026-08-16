/** @public — filesystem-backed flow store using ~/.hive/flows/ */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HIVE_DIR } from "shared/hive-dir";
import type { RuntimeWorkflowInstanceState } from "workflow-engine/shared/workflow-instance-state";

// The full store surface the server uses: the engine's write-only
// FlowPersistence (saveFlow/saveInstance — what the flow runtime calls) plus
// the read/recovery/delete surface that lives server-side (rehydrate at boot,
// unlink/purge). The runtime never sees these; the server does.
export type FlowStore = {
  saveFlow(flowId: string, config: unknown, state: unknown): void;
  saveInstance(
    flowId: string,
    instanceId: string,
    workflowId: string,
    state: RuntimeWorkflowInstanceState
  ): void;
  deleteInstance(flowId: string, instanceId: string): void;
  deleteFlow(flowId: string): void;
  loadFlow(flowId: string): {
    config: unknown;
    state: unknown;
    instances: Array<{
      instanceId: string;
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
    }>;
  } | null;
  loadAllFlows(): Array<{
    flowId: string;
    config: unknown;
    state: unknown;
    instances: Array<{
      instanceId: string;
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
    }>;
  }>;
};

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
    // The file was written by this module with the same T shape; JSON.parse
    // returns unknown so the caller's type parameter is asserted at this boundary.
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
  state: RuntimeWorkflowInstanceState;
};

export function createFlowPersistence(
  flowsDir: string = DEFAULT_FLOWS_DIR
): FlowStore {
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

  function listInstanceIds(flowId: string): string[] {
    const dir = instancesDir(flowId);
    try {
      const entries = readdirSync(dir);
      const seen = new Set<string>();
      for (const name of entries) {
        const match = name.match(/^(.+?)\.json$/);
        if (match) seen.add(match[1]);
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
    state: RuntimeWorkflowInstanceState
  ): void {
    atomicWrite(instanceFilePath(flowId, instanceId), {
      workflowId,
      state,
    } satisfies PersistedInstance);
  }

  function loadFlow(flowId: string): {
    config: unknown;
    state: unknown;
    instances: Array<{
      instanceId: string;
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
    }>;
  } | null {
    const flow = readJson<PersistedFlow>(flowFilePath(flowId));
    if (!flow) return null;

    const ids = listInstanceIds(flowId);
    const instances: Array<{
      instanceId: string;
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
    }> = [];

    for (const id of ids) {
      const persisted = readJson<PersistedInstance>(
        instanceFilePath(flowId, id)
      );
      if (!persisted) continue;

      instances.push({
        instanceId: id,
        workflowId: persisted.workflowId,
        // Running-task context persists embedded in the instance state
        // (saveInstance writes it); rehydrate clears running tasks anyway.
        state: persisted.state,
      });
    }

    return { config: flow.config, state: flow.state, instances };
  }

  function loadAllFlows(): Array<{
    flowId: string;
    config: unknown;
    state: unknown;
    instances: Array<{
      instanceId: string;
      workflowId: string;
      state: RuntimeWorkflowInstanceState;
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
        .map((name) => {
          const flow = loadFlow(decodeURIComponent(name));
          if (!flow) return null;
          return { flowId: decodeURIComponent(name), ...flow };
        })
        .filter((flow): flow is NonNullable<typeof flow> => flow !== null);
    } catch {
      return [];
    }
  }

  function deleteInstance(flowId: string, instanceId: string): void {
    // The runtime calls this when an instance is removed (E5); the persisted
    // file is gone so the instance cannot resurrect on the next boot.
    rmSync(instanceFilePath(flowId, instanceId), { force: true });
  }

  function deleteFlow(flowId: string): void {
    rmSync(flowDir(flowId), { recursive: true, force: true });
  }

  return {
    saveFlow,
    saveInstance,
    deleteInstance,
    deleteFlow,
    loadFlow,
    loadAllFlows,
  };
}
