// Module-level singleton holding the authoritative flow state pushed over the
// flow WebSocket. The server sends whole-flow snapshots (init on connect,
// flow_snapshot on any flow change, flow_deleted on removal); the store applies
// each directly and pages render from it with no per-event REST refetch. On
// reconnect the server re-sends init, which replaces the store and closes the
// missed-events hole during a drop.

import { slugify } from "shared/slugify";
import type { FlowResponse, FlowWsMessage } from "../flow-api";
import { applyMessage } from "./flow-store/apply-message";

let flows = $state<FlowResponse[]>([]);
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1_000;
let disconnectedByCaller = false;

function upsert(flow: FlowResponse): void {
  flows = applyMessage(flows, { type: "flow_snapshot", flow });
}

function removeFlow(flowId: string): void {
  flows = applyMessage(flows, { type: "flow_deleted", flowId });
}

function scheduleReconnect(): void {
  reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  reconnectTimer = setTimeout(() => {
    connect();
  }, reconnectDelay);
}

function connect(): void {
  disconnectedByCaller = false;
  closeSocket();
  reconnectDelay = 1_000;

  const protocol = window.location.protocol === "http:" ? "ws:" : "wss:";
  const opened = new WebSocket(
    `${protocol}//${window.location.host}/api/flows/ws`
  );
  socket = opened;

  opened.onmessage = (event) => {
    try {
      // The server sends init/flow_snapshot/flow_deleted frames; malformed
      // frames are dropped so a bad payload cannot wedge the store.
      const message = JSON.parse(String(event.data)) as FlowWsMessage;
      flows = applyMessage(flows, message);
    } catch {
      // ignore malformed frames
    }
  };

  opened.onclose = () => {
    if (socket !== opened) return;
    socket = null;
    if (!disconnectedByCaller) scheduleReconnect();
  };
}

function closeSocket(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
}

function disconnect(): void {
  disconnectedByCaller = true;
  closeSocket();
}

export const flowStore = {
  connect,
  disconnect,
  get flows() {
    return flows;
  },
  getFlow(flowId: string): FlowResponse | null {
    return flows.find((flow) => flow.id === flowId) ?? null;
  },
  findFlow(definitionId: string, name: string): FlowResponse | null {
    return (
      flows.find(
        (flow) =>
          flow.config?.definitionId === definitionId &&
          slugify(String(flow.config?.name ?? "")) === name
      ) ?? null
    );
  },
  upsert,
  removeFlow,
};
