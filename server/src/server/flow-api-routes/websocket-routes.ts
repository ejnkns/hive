/** @private — the /api/flows/ws realtime endpoint: per-flow coalesced
 * snapshots pushed on runtime events. */

import type { FastifyInstance } from "fastify";
import {
  getFlowRuntime,
  getFlowRuntimes,
  onFlowEvent,
} from "../flow-registry.ts";
import { flowPayload } from "./flow-payload.ts";

export function registerWebsocketRoutes(server: FastifyInstance): void {
  // ── WebSocket endpoint ──

  // Per-flow trailing timer: a burst of runtime events (task_started,
  // state_changed, ...) coalesces into one snapshot per flowId instead of one
  // full snapshot per event. The snapshot is computed when the timer fires, so
  // a burst settles into a single authoritative whole-flow snapshot.
  const SNAPSHOT_COALESCE_DELAY_MS = 75;

  // WebSocket.OPEN readyState. The socket is a `ws` WebSocket whose readyState
  // follows the spec constants; the numeric value avoids a runtime dependency
  // on the `ws` package (only @fastify/websocket's type is imported).
  const OPEN_READY_STATE = 1;

  server.get("/api/flows/ws", { websocket: true }, (socket) => {
    const pendingSnapshots = new Map<string, ReturnType<typeof setTimeout>>();

    function sendMessage(message: object): void {
      if (socket.readyState !== OPEN_READY_STATE) return;
      try {
        socket.send(JSON.stringify(message));
      } catch {
        // socket closed
      }
    }

    function scheduleSnapshot(flowId: string): void {
      const existing = pendingSnapshots.get(flowId);
      if (existing !== undefined) clearTimeout(existing);
      pendingSnapshots.set(
        flowId,
        setTimeout(() => {
          pendingSnapshots.delete(flowId);
          const runtime = getFlowRuntime(flowId);
          if (!runtime) return;
          sendMessage({
            type: "flow_snapshot",
            flow: flowPayload(flowId, runtime),
          });
        }, SNAPSHOT_COALESCE_DELAY_MS)
      );
    }

    // Hydrate the connection with the full current state. Events emitted while
    // the handler runs are queued after this frame, so the client's init
    // replace-then-update ordering always holds.
    sendMessage({
      type: "init",
      flows: Array.from(getFlowRuntimes()).map(([flowId, runtime]) =>
        flowPayload(flowId, runtime)
      ),
    });

    // Branch on the event kind before any flowPayload lookup: flow_deleted
    // fires after the runtime is gone, so it must never touch the registry.
    const unsubscribe = onFlowEvent((event) => {
      if (event.type === "flow_deleted") {
        const pending = pendingSnapshots.get(event.flowId);
        if (pending !== undefined) {
          clearTimeout(pending);
          pendingSnapshots.delete(event.flowId);
        }
        sendMessage({ type: "flow_deleted", flowId: event.flowId });
        return;
      }
      scheduleSnapshot(event.flowId);
    });

    socket.on("close", () => {
      unsubscribe();
      for (const pending of pendingSnapshots.values()) {
        clearTimeout(pending);
      }
      pendingSnapshots.clear();
    });
  });
}
