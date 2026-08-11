/** @private — flow-level REST routes: list/detail/create/delete, config
 * patch, and flow-level action dispatch. */

import type { FastifyInstance } from "fastify";
import { slugify } from "shared/slugify";
import { getRegisteredFlowDefinition } from "../flow-definitions.ts";
import {
  createFlow,
  dispatchFlowLevelAction,
  getFlowPersistence,
  getFlowRuntime,
  getFlowRuntimes,
  purgeFlow,
  unlinkFlow,
  validateInstanceConfig,
} from "../flow-registry.ts";
import { HttpError } from "../http-error.ts";
import { flowPayload } from "./flow-payload.ts";

export function registerFlowsRoutes(server: FastifyInstance): void {
  server.get("/api/flows", async (request, reply) => {
    // Fastify query types are erased; shape guaranteed by route usage
    const query = request.query as { definitionId?: string; name?: string };
    let flows = Array.from(getFlowRuntimes())
      // Hidden definitions (the flow-authoring session) are driven by the
      // editor, not the library — their flow instances must not appear here.
      .filter(([, runtime]) => {
        const cfg = runtime.getFlowConfig() as Record<string, unknown>;
        const def =
          typeof cfg.definitionId === "string"
            ? getRegisteredFlowDefinition(cfg.definitionId)
            : undefined;
        return def === undefined || !def.hidden;
      })
      .map(([flowId, runtime]) => flowPayload(flowId, runtime));

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
}
