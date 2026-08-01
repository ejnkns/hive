import type { FastifyInstance } from "fastify";
import type { FlowRuntimeEvent } from "workflow-engine/create-flow-runtime";
import type { WebSocket } from "ws";
import {
  DefinitionAlreadyExistsError,
  deleteUserDefinition,
  getRegisteredFlowDefinition,
  listRegisteredDefinitions,
  registerUserDefinition,
  slugify,
  updateUserDefinition,
} from "./flow-definitions";
import {
  createFlow,
  getFlowPersistence,
  getFlowRuntime,
  getFlowRuntimes,
  purgeFlow,
  unlinkFlow,
  validateInstanceConfig,
} from "./flow-registry";
import { computeInstanceStatus } from "./instance-status";

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

  function flowPayload(
    flowId: string,
    runtime: NonNullable<ReturnType<typeof getFlowRuntime>>
  ) {
    const cfg = runtime.getFlowConfig();
    const workflows = runtime.getWorkflowDefinitions();
    const instances = runtime.getWorkflowInstanceEntries();
    return {
      id: flowId,
      label: (cfg.name as string) ?? flowId,
      status: computeInstanceStatus(workflows, instances),
      config: cfg,
      workflows,
      instances,
    };
  }

  server.get("/api/flows", async (request, reply) => {
    // Fastify query types are erased; shape guaranteed by route usage
    const query = request.query as { definitionId?: string; name?: string };
    let flows = Array.from(getFlowRuntimes()).map(([flowId, runtime]) =>
      flowPayload(flowId, runtime)
    );

    if (query.definitionId !== undefined || query.name !== undefined) {
      flows = flows.filter((flow) => {
        const matchesDefinition =
          query.definitionId === undefined ||
          flow.config?.definitionId === query.definitionId;
        const matchesName =
          query.name === undefined ||
          slugify(String(flow.config?.name ?? "")) === query.name;
        return matchesDefinition && matchesName;
      });
    }

    return reply.send({ flows });
  });

  server.get("/api/flows/:flowId", async (request, reply) => {
    // Fastify params type is erased; shape guaranteed by route pattern
    const { flowId } = request.params as { flowId: string };
    const runtime = getFlowRuntime(flowId);
    if (!runtime) {
      return reply.status(404).send({ error: "Flow not found" });
    }

    return reply.send(flowPayload(flowId, runtime));
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
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const source = typeof body?.source === "string" ? body.source : "";
    const description =
      typeof body?.description === "string" ? body.description : undefined;
    if (name === "") {
      return reply.status(400).send({ error: "name is required" });
    }
    if (source === "") {
      return reply.status(400).send({ error: "source is required" });
    }

    try {
      const record = await registerUserDefinition({
        name,
        description,
        source,
      });
      return reply.status(201).send({
        ok: true,
        id: record.id,
        name: record.name,
        builtIn: record.builtIn,
        configSchema: record.configSchema,
      });
    } catch (err) {
      if (err instanceof DefinitionAlreadyExistsError) {
        return reply.status(409).send({ error: err.message });
      }
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Invalid definition",
      });
    }
  });

  server.put("/api/flows/definitions/:id", async (request, reply) => {
    // Fastify params type is erased; shape guaranteed by route pattern
    const { id } = request.params as { id: string };
    // Fastify body is unknown; validated below
    const body = request.body as Record<string, unknown> | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const source = typeof body?.source === "string" ? body.source : "";
    const description =
      typeof body?.description === "string" ? body.description : undefined;
    if (name === "") {
      return reply.status(400).send({ error: "name is required" });
    }
    if (source === "") {
      return reply.status(400).send({ error: "source is required" });
    }

    try {
      const record = await updateUserDefinition(id, {
        name,
        description,
        source,
      });
      return reply.send({
        ok: true,
        id: record.id,
        name: record.name,
        builtIn: record.builtIn,
        configSchema: record.configSchema,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) {
        return reply.status(404).send({ error: err.message });
      }
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
    // Fastify body is unknown; validated below
    const body = request.body as { purge?: boolean } | null;

    const runtime = getFlowRuntime(flowId);
    if (!runtime) {
      return reply.status(404).send({ error: "Flow not found" });
    }

    if (body?.purge === true) {
      purgeFlow(flowId);
    } else {
      unlinkFlow(flowId);
    }
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

    const validationErrors = validateInstanceConfig(definitionId, config);
    if (validationErrors.length > 0) {
      return reply
        .status(400)
        .send({ error: `Invalid flow config: ${validationErrors.join("; ")}` });
    }

    // Instance names slugify to route segments; "new" is reserved. Names must
    // be unique within the definition's instances.
    const instanceSlug = slugify(String(config.name));
    if (instanceSlug === "") {
      return reply
        .status(400)
        .send({ error: "Instance name must produce a non-empty slug" });
    }
    if (instanceSlug === "new") {
      return reply.status(400).send({ error: '"new" is a reserved flow name' });
    }
    const duplicateInDefinition = Array.from(getFlowRuntimes()).some(
      ([, runtime]) => {
        const existing = runtime.getFlowConfig() as Record<string, unknown>;
        return (
          existing.definitionId === definitionId &&
          slugify(String(existing.name)) === instanceSlug
        );
      }
    );
    if (duplicateInDefinition) {
      return reply.status(409).send({
        error: `An instance named "${config.name}" already exists for this definition`,
      });
    }

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
// until it does not collide with an existing runtime. Instance names are unique
// within a definition (enforced at POST), but flow ids are a global map key so
// same-named instances across definitions still get distinct ids.
function generateFlowId(
  definitionId: string,
  config: Record<string, unknown>
): string {
  const name = typeof config.name === "string" ? config.name : definitionId;
  const slug = slugify(name) || definitionId;

  const existing = new Set(Array.from(getFlowRuntimes().keys()));
  if (!existing.has(slug)) return slug;
  let n = 2;
  while (existing.has(`${slug}-${n}`)) {
    n++;
  }
  return `${slug}-${n}`;
}
