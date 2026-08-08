import type { FastifyInstance } from "fastify";
import { slugify } from "shared/slugify";
import {
  DefinitionAlreadyExistsError,
  deleteUserDefinition,
  getDefinitionComponentSource,
  getFlowDefinition,
  getRegisteredFlowDefinition,
  listRegisteredDefinitions,
  registerUserDefinition,
  updateUserDefinition,
} from "./flow-definitions";
import {
  createFlow,
  dispatchFlowLevelAction,
  getAvailableFlowActions,
  getFlowPersistence,
  getFlowRuntime,
  getFlowRuntimes,
  onFlowEvent,
  purgeFlow,
  unlinkFlow,
  validateInstanceConfig,
} from "./flow-registry";
import { generateFlowDefinitionSource } from "./generate-flow-definition";
import { HttpError } from "./http-error";
import { computeInstanceStatus } from "./instance-status";
import { checkDefinitionSources } from "./schema-consistency";

export function registerFlowApiRoutes(server: FastifyInstance): void {
  // ── REST endpoints ──

  function flowPayload(
    flowId: string,
    runtime: NonNullable<ReturnType<typeof getFlowRuntime>>
  ) {
    const cfg = runtime.getFlowConfig();
    const workflows = runtime.getWorkflowDefinitions();
    const instances = runtime.getWorkflowInstanceEntries();
    // The raw definition TS source is internal (the server re-transpiles it on
    // rehydrate); it is not part of the client contract and must not ship to
    // every flow snapshot.
    const { definitionSource: _definitionSource, ...clientConfig } = cfg;
    // Flow-level rendering declarations come from the flow's definition (the
    // runtime carries only the resolved workflow configs). The UI uses them to
    // validate and fall back on custom render kinds.
    const definitionId = cfg.definitionId;
    const definition =
      typeof definitionId === "string"
        ? getFlowDefinition(definitionId)
        : undefined;
    // Declared component ids mapped to their serve paths. The UI fetches each
    // module from this path, evaluates it, and registers the returned
    // components/kinds. A definition that no longer exists degrades to no
    // components (unknown instanceComponents fall back to the default card).
    const declaredComponents =
      typeof definitionId === "string"
        ? (definition?.ui?.components ?? {})
        : {};
    const definitionSlug = typeof definitionId === "string" ? definitionId : "";
    const components = Object.fromEntries(
      Object.keys(declaredComponents).map((componentId) => [
        componentId,
        `/api/flows/definitions/${encodeURIComponent(definitionSlug)}/components/${encodeURIComponent(componentId)}`,
      ])
    );
    return {
      id: flowId,
      label: (cfg.name as string) ?? flowId,
      status: computeInstanceStatus(workflows, instances),
      config: clientConfig,
      workflows,
      instances,
      ui: {
        kinds: definition?.ui?.kinds ?? [],
        components,
      },
      availableFlowActions: getAvailableFlowActions(flowId),
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
    "/api/flows/:flowId/actions/:actionId",
    async (request, reply) => {
      // Fastify params type is erased; shape guaranteed by route pattern
      const { flowId, actionId } = request.params as {
        flowId: string;
        actionId: string;
      };
      // Fastify body is unknown; validated by the action's field collection
      const body = request.body as Record<string, unknown> | null;

      if (!getFlowRuntime(flowId)) {
        return reply.status(404).send({ error: "Flow not found" });
      }

      try {
        const result = dispatchFlowLevelAction(flowId, actionId, body ?? {});
        return reply.send({ ok: true, ...result });
      } catch (err) {
        // Errors carry their HTTP status; anything else is an internal bug.
        if (err instanceof HttpError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        return reply.status(500).send({ error: "Internal error" });
      }
    }
  );

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

  // Served component module: the transpiled ESM source of a definition-declared
  // Lit component (FlowDefinition.ui.components). Consumed by the rendering
  // surface via fetch + dynamic import; 404 when the definition or component id
  // is unknown so the client degrades to the generic defaults.
  server.get(
    "/api/flows/definitions/:id/components/:componentId",
    async (request, reply) => {
      const { id, componentId } = request.params as {
        id: string;
        componentId: string;
      };
      const source = getDefinitionComponentSource(id, componentId);
      if (source === undefined) {
        return reply.status(404).send({ error: "Component not found" });
      }
      return reply
        .header("Content-Type", "text/javascript; charset=utf-8")
        .header("Cache-Control", "no-store")
        .send(source);
    }
  );

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

  server.post("/api/flows/definitions/generate", async (request, reply) => {
    // Fastify body is unknown; validated below
    const body = request.body as { prompt?: string } | null;
    const prompt = body?.prompt;
    if (typeof prompt !== "string" || prompt.trim() === "") {
      return reply.status(400).send({ error: "prompt is required" });
    }

    try {
      const { source, report } = await generateFlowDefinitionSource(
        prompt.trim()
      );
      return reply.send({ source, report });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Generation failed",
      });
    }
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
      const check = checkDefinitionSources([
        { path: `${record.id}.ts`, source },
      ]);
      return reply.status(201).send({
        ok: true,
        id: record.id,
        name: record.name,
        builtIn: record.builtIn,
        configSchema: record.configSchema,
        // Non-blocking: the definition loads and runs; these are the
        // schema-consistency findings (e.g. a gate reading a never-written
        // field) the editor surfaces for the author to fix.
        checkWarnings: check.warnings,
        checkErrors: check.errors,
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
      const check = checkDefinitionSources([
        { path: `${record.id}.ts`, source },
      ]);
      return reply.send({
        ok: true,
        id: record.id,
        name: record.name,
        builtIn: record.builtIn,
        configSchema: record.configSchema,
        checkWarnings: check.warnings,
        checkErrors: check.errors,
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
