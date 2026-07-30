import type { FastifyInstance } from "fastify";
import type { FlowRuntimeEvent } from "workflow-engine/create-flow-runtime";
import type { WebSocket } from "ws";
import {
  createFlowFromDefinition,
  type DataDrivenWorkflowDef,
  getAllFlows,
  getFlowPersistence,
  getFlowRuntime,
} from "./flow-registry";

export function registerFlowApiRoutes(server: FastifyInstance): void {
  const activeSockets = new Set<WebSocket>();
  const unsubscribers: Array<() => void> = [];

  function broadcastFlowEvent(event: FlowRuntimeEvent): void {
    if (activeSockets.size === 0) return;
    const payload = JSON.stringify(event);
    for (const socket of activeSockets) {
      try {
        socket.send(payload);
      } catch {
        // socket closed
      }
    }
  }

  function subscribeToFlowEvents(): void {
    for (const flow of getAllFlows()) {
      const runtime = getFlowRuntime(flow.id);
      if (!runtime) continue;
      const unsub = runtime.on((event) => {
        broadcastFlowEvent(event);
      });
      unsubscribers.push(unsub);
    }
  }

  // ── REST endpoints ──

  server.get("/api/flows", async (_request, reply) => {
    const flows = getAllFlows();
    const result = flows
      .map((flow) => {
        const runtime = getFlowRuntime(flow.id);
        if (!runtime) return null;

        return {
          id: flow.id,
          label: flow.name,
          workflows: runtime.getWorkflowDefinitions(),
          instances: runtime.getWorkflowInstanceEntries(),
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    return reply.send({ flows: result });
  });

  server.get("/api/flows/:flowId/instances", async (request, reply) => {
    const { flowId } = request.params as { flowId: string };
    const runtime = getFlowRuntime(flowId);
    if (!runtime) {
      return reply.status(404).send({ error: "Flow not found" });
    }

    return reply.send({
      instances: runtime.getWorkflowInstanceEntries(),
    });
  });

  server.post(
    "/api/flows/:flowId/instances/:instanceId/action",
    async (request, reply) => {
      const { flowId, instanceId } = request.params as {
        flowId: string;
        instanceId: string;
      };
      const body = request.body as { actionId?: string } | null;

      if (!body?.actionId || typeof body.actionId !== "string") {
        return reply.status(400).send({ error: "actionId is required" });
      }

      const runtime = getFlowRuntime(flowId);
      if (!runtime) {
        return reply.status(404).send({ error: "Flow not found" });
      }

      const controller = runtime.getWorkflowInstance(instanceId);
      if (!controller) {
        return reply.status(404).send({ error: "Instance not found" });
      }

      const before = controller.getState().currentState;
      controller.dispatchAction(body.actionId);
      const after = controller.getState().currentState;

      if (before === after) {
        return reply.status(409).send({
          error: "Action rejected or unavailable",
          actionId: body.actionId,
        });
      }

      return reply.send({
        instanceId,
        previousState: before,
        currentState: after,
        state: controller.getState(),
        availableActions: controller.getAvailableActions(),
      });
    }
  );

  server.post(
    "/api/flows/:flowId/instances/:instanceId/task/input",
    async (request, reply) => {
      const { flowId, instanceId } = request.params as {
        flowId: string;
        instanceId: string;
      };
      const body = request.body as { content?: string } | null;

      if (!body?.content || typeof body.content !== "string") {
        return reply.status(400).send({ error: "content is required" });
      }

      const runtime = getFlowRuntime(flowId);
      if (!runtime) {
        return reply.status(404).send({ error: "Flow not found" });
      }

      const controller = runtime.getWorkflowInstance(instanceId);
      if (!controller) {
        return reply.status(404).send({ error: "Instance not found" });
      }

      const state = controller.getState();
      if (!state.hasRunningTask) {
        return reply.status(409).send({
          error: "No running task on this instance",
        });
      }

      if (state.runningTaskContext?.role !== "ai-chat") {
        return reply.status(409).send({
          error: "Running task is not an ai-chat session",
          role: state.runningTaskContext?.role,
        });
      }

      const taskId = state.runningTaskId;
      if (!taskId) {
        return reply.status(409).send({ error: "No running task ID" });
      }

      controller.sendTaskInput(taskId, body.content, "user");

      return reply.send({
        sent: true,
        instanceId,
        runningTaskContext: controller.getState().runningTaskContext,
      });
    }
  );

  server.post("/api/flows/definitions", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body.id !== "string" || !Array.isArray(body.states)) {
      return reply.status(400).send({
        error:
          "Invalid definition: id (string) and states (array) are required",
      });
    }

    const persistence = getFlowPersistence();
    if (!persistence) {
      return reply
        .status(500)
        .send({ error: "Flow persistence not available" });
    }

    const existing = getFlowRuntime(body.id);
    if (existing) {
      return reply
        .status(409)
        .send({ error: `Flow "${body.id}" already exists` });
    }

    try {
      const def = body as unknown as DataDrivenWorkflowDef;
      const runtime = createFlowFromDefinition(body.id, def, persistence);
      return reply.status(201).send({
        ok: true,
        flowId: body.id,
        workflows: runtime.getWorkflowDefinitions(),
      });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Invalid definition",
      });
    }
  });

  server.patch("/api/flows/:flowId/config", async (request, reply) => {
    const { flowId } = request.params as { flowId: string };
    const body = request.body as Record<string, unknown> | null;

    if (!body || Object.keys(body).length === 0) {
      return reply.status(400).send({ error: "Config patch body is required" });
    }

    const runtime = getFlowRuntime(flowId);
    if (!runtime) {
      return reply.status(404).send({ error: "Flow not found" });
    }

    runtime.patchFlowConfig(body);

    return reply.send({
      ok: true,
      flowId,
      config: runtime.getFlowConfig(),
    });
  });

  // ── WebSocket endpoint ──

  server.get("/api/flows/ws", { websocket: true }, (socket) => {
    activeSockets.add(socket);

    const currentUnsubscribers: Array<() => void> = [];

    for (const flow of getAllFlows()) {
      const runtime = getFlowRuntime(flow.id);
      if (!runtime) continue;
      const unsub = runtime.on((event) => {
        try {
          socket.send(JSON.stringify(event));
        } catch {
          // socket closed
        }
      });
      currentUnsubscribers.push(unsub);
    }

    socket.on("close", () => {
      activeSockets.delete(socket);
      for (const unsub of currentUnsubscribers) {
        unsub();
      }
    });
  });

  // ── Cleanup on close ──
  server.addHook("onClose", (_instance, done) => {
    for (const unsub of unsubscribers) {
      unsub();
    }
    unsubscribers.length = 0;
    activeSockets.clear();
    done();
  });

  subscribeToFlowEvents();
}
