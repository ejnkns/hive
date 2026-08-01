import type { FastifyInstance } from "fastify";
import type { FlowRuntimeEvent } from "workflow-engine/create-flow-runtime";
import type { WebSocket } from "ws";
import {
  deleteUserDefinition,
  getRegisteredFlowDefinition,
  listRegisteredDefinitions,
} from "./flow-definitions";
import {
  createFlow,
  createFlowFromDefinition,
  type DataDrivenWorkflowDef,
  getFlowPersistence,
  getFlowRuntime,
  getFlowRuntimes,
  unlinkFlow,
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
    for (const [flowId] of getFlowRuntimes()) {
      const runtime = getFlowRuntime(flowId);
      if (!runtime) continue;
      const unsub = runtime.on((event) => {
        broadcastFlowEvent(event);
      });
      unsubscribers.push(unsub);
    }
  }

  // ── REST endpoints ──

  server.get("/api/flows", async (_request, reply) => {
    const flows = Array.from(getFlowRuntimes()).map(([flowId, runtime]) => {
      const cfg = runtime.getFlowConfig();
      return {
        id: flowId,
        label: (cfg.name as string) ?? flowId,
        config: cfg,
        workflows: runtime.getWorkflowDefinitions(),
        instances: runtime.getWorkflowInstanceEntries(),
      };
    });

    return reply.send({ flows });
  });

  server.get("/api/flows/:flowId", async (request, reply) => {
    // Fastify params type is erased; shape guaranteed by route pattern
    const { flowId } = request.params as { flowId: string };
    const runtime = getFlowRuntime(flowId);
    if (!runtime) {
      return reply.status(404).send({ error: "Flow not found" });
    }

    const cfg = runtime.getFlowConfig();
    return reply.send({
      id: flowId,
      label: (cfg.name as string) ?? flowId,
      config: cfg,
      workflows: runtime.getWorkflowDefinitions(),
      instances: runtime.getWorkflowInstanceEntries(),
    });
  });

  server.get("/api/flows/:flowId/instances", async (request, reply) => {
    // Fastify params type is erased; shape guaranteed by route pattern
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
      // Fastify params type is erased; shape guaranteed by route pattern
      const { flowId, instanceId } = request.params as {
        flowId: string;
        instanceId: string;
      };
      // Fastify body is unknown; validated below with typeof checks
      const body = request.body as Record<string, unknown> | null;

      const actionId = body?.actionId;
      if (typeof actionId !== "string") {
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
      controller.dispatchAction(actionId);
      const after = controller.getState().currentState;

      if (before === after) {
        return reply.status(409).send({
          error: "Action rejected or unavailable",
          actionId,
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
      // Fastify params type is erased; shape guaranteed by route pattern
      const { flowId, instanceId } = request.params as {
        flowId: string;
        instanceId: string;
      };
      // Fastify body is unknown; validated below with typeof check
      const body = request.body as Record<string, unknown> | null;
      const content = body?.content;
      if (typeof content !== "string") {
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

      controller.sendTaskInput(taskId, content, "user");

      return reply.send({
        sent: true,
        instanceId,
        runningTaskContext: controller.getState().runningTaskContext,
      });
    }
  );

  // ── Flow definition library ──

  server.get("/api/flows/definitions", async (_request, reply) => {
    const definitions = listRegisteredDefinitions().map(
      ({ id, name, description, builtIn, configSchema }) => ({
        id,
        name,
        description,
        builtIn,
        configSchema,
      })
    );
    return reply.send({ definitions });
  });

  server.get("/api/flows/definitions/:id", async (request, reply) => {
    // Fastify params type is erased; shape guaranteed by route pattern
    const { id } = request.params as { id: string };
    const record = getRegisteredFlowDefinition(id);
    if (!record) {
      return reply.status(404).send({ error: "Flow definition not found" });
    }
    return reply.send({
      id: record.id,
      name: record.name,
      description: record.description,
      builtIn: record.builtIn,
      configSchema: record.configSchema,
      source: record.source,
    });
  });

  server.delete("/api/flows/definitions/:id", async (request, reply) => {
    // Fastify params type is erased; shape guaranteed by route pattern
    const { id } = request.params as { id: string };
    const record = getRegisteredFlowDefinition(id);
    if (!record) {
      return reply.status(404).send({ error: "Flow definition not found" });
    }
    if (record.builtIn) {
      return reply
        .status(409)
        .send({ error: "Built-in flow definitions cannot be deleted" });
    }
    deleteUserDefinition(id);
    return reply.send({ ok: true, id });
  });

  server.post("/api/flows/definitions", async (request, reply) => {
    // Fastify body is unknown; validated below
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
      // body.id and body.states validated above; shape matches DataDrivenWorkflowDef
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
    // Fastify params type is erased; shape guaranteed by route pattern
    const { flowId } = request.params as { flowId: string };
    // Fastify body is unknown; validated below
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

  server.delete("/api/flows/:flowId", async (request, reply) => {
    // Fastify params type is erased; shape guaranteed by route pattern
    const { flowId } = request.params as { flowId: string };

    const runtime = getFlowRuntime(flowId);
    if (!runtime) {
      return reply.status(404).send({ error: "Flow not found" });
    }

    unlinkFlow(flowId);
    return reply.send({ ok: true, flowId });
  });

  server.post("/api/flows", async (request, reply) => {
    // Fastify body is unknown; validated below
    const body = request.body as Record<string, unknown> | null;
    const definitionId = body?.definitionId;
    if (typeof definitionId !== "string") {
      return reply.status(400).send({ error: "definitionId is required" });
    }

    const persistence = getFlowPersistence();
    if (!persistence) {
      return reply
        .status(500)
        .send({ error: "Flow persistence not available" });
    }

    const config =
      body?.config !== null && typeof body?.config === "object"
        ? (body.config as Record<string, unknown>)
        : {};
    const flowId =
      typeof body?.flowId === "string" && body.flowId !== ""
        ? body.flowId
        : generateFlowId(definitionId, config);

    if (getFlowRuntime(flowId)) {
      return reply
        .status(409)
        .send({ error: `Flow "${flowId}" already exists` });
    }

    try {
      const runtime = createFlow(flowId, definitionId, persistence, config);
      return reply.status(201).send({
        ok: true,
        flowId,
        workflows: runtime.getWorkflowDefinitions(),
      });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Invalid flow definition",
      });
    }
  });

  // ── WebSocket endpoint ──

  server.get("/api/flows/ws", { websocket: true }, (socket) => {
    activeSockets.add(socket);

    const currentUnsubscribers: Array<() => void> = [];

    for (const [flowId] of getFlowRuntimes()) {
      const runtime = getFlowRuntime(flowId);
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

// Derives a unique flow id from the requested name or definition id, suffixing
// until it does not collide with an existing runtime.
function generateFlowId(
  definitionId: string,
  config: Record<string, unknown>
): string {
  const name = typeof config.name === "string" ? config.name : definitionId;
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || definitionId;

  const existing = new Set(Array.from(getFlowRuntimes().keys()));
  if (!existing.has(slug)) return slug;
  let n = 2;
  while (existing.has(`${slug}-${n}`)) {
    n++;
  }
  return `${slug}-${n}`;
}
