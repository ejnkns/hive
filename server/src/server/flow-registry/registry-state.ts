/** @private — the registry's process-global state and accessors: the runtime
 * map, the flow event hub, and persistence. Exposed through narrow functions
 * so callers never touch the maps directly. */

import { rmSync } from "node:fs";
import { join } from "node:path";
import type {
  FlowRuntimeAPI,
  FlowRuntimeEvent,
} from "workflow-engine/create-flow-runtime";
import { readFlowSettings } from "workflow-engine/runners";
import type { FlowStore } from "../flow-persistence.ts";

const runtimes = new Map<
  string,
  FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
>();
let _persistence: FlowStore | null = null;

// ── Flow event hub ──
//
// The single authoritative stream of flow lifecycle events. Every runtime
// created or rehydrated here is wired into the hub, and unlink/purge emit a
// deletion, so a listener (e.g. the flow WebSocket endpoint) observes all flow
// state changes without subscribing to each runtime itself.

export type FlowEventBusEvent =
  | { type: "flow_deleted"; flowId: string }
  | { type: "flow_event"; flowId: string; event: FlowRuntimeEvent };

const flowEventListeners = new Set<(event: FlowEventBusEvent) => void>();

export function onFlowEvent(
  listener: (event: FlowEventBusEvent) => void
): () => void {
  flowEventListeners.add(listener);
  return () => {
    flowEventListeners.delete(listener);
  };
}

function emitFlowEvent(event: FlowEventBusEvent): void {
  for (const listener of flowEventListeners) {
    listener(event);
  }
}

// Subscribes a runtime's events into the hub. The registry owns the runtime's
// lifetime, so the subscription is never torn down explicitly — it dies with
// the runtime when unlink/purge drops the last reference.
function wireRuntimeToEventHub(
  flowId: string,
  runtime: FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
): void {
  runtime.on((event) => {
    emitFlowEvent({ type: "flow_event", flowId, event });
  });
}

// ── Persistence accessors ──

export function setFlowPersistence(persistence: FlowStore): void {
  _persistence = persistence;
}

export function getFlowPersistence(): FlowStore | null {
  return _persistence;
}

// ── Runtime accessors ──

export function registerFlowForTest(
  flowId: string,
  runtime: FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
): void {
  runtimes.set(flowId, runtime);
  wireRuntimeToEventHub(flowId, runtime);
}

export function getFlowRuntime(
  flowId: string
):
  | FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
  | undefined {
  return runtimes.get(flowId);
}

export function getFlowRuntimes(): Map<
  string,
  FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
> {
  return runtimes;
}

// Test seam: clears the live runtime map so tests start fresh. Production
// callers never invoke this.
export function resetFlowRuntimesForTest(): void {
  runtimes.clear();
}

export function unlinkFlow(flowId: string): void {
  runtimes.delete(flowId);
  emitFlowEvent({ type: "flow_deleted", flowId });
  _persistence?.deleteFlow(flowId);
}

// Removes operational state like unlinkFlow, and additionally deletes the
// flow's authoritative domain state under basePath/<domainDir>. The domain
// root comes from the flow config (default .<definition-id>); without a base
// path purge degrades to a plain unlink.
export function purgeFlow(flowId: string): void {
  const runtime = runtimes.get(flowId);
  const config = runtime?.getFlowConfig() as
    | Record<string, unknown>
    | undefined;
  const { basePath, domainDir } = readFlowSettings(config ?? {});

  unlinkFlow(flowId);

  if (basePath && domainDir) {
    rmSync(join(basePath, domainDir), { recursive: true, force: true });
  }
}

// Registers a runtime and wires it into the event hub (createFlow's
// registration step, kept behind one function so the maps stay private).
export function registerRuntime(
  flowId: string,
  runtime: FlowRuntimeAPI<Record<string, unknown>, Record<string, unknown>>
): void {
  runtimes.set(flowId, runtime);
  wireRuntimeToEventHub(flowId, runtime);
}
