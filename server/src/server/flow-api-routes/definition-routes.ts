/** @private — flow-definition REST routes: CRUD, served component source,
 * and the generate/author/validate authoring surface. */

import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { AUTHORING_DEFINITION_ID } from "../flow-authoring";
import {
  DefinitionAlreadyExistsError,
  deleteUserDefinition,
  getDefinitionComponentSource,
  getRegisteredFlowDefinition,
  listRegisteredDefinitions,
  loadDefinitionFromSource,
  registerUserDefinition,
  updateUserDefinition,
} from "../flow-definitions";
import { createFlow, getFlowPersistence } from "../flow-registry";
import { generateFlowDefinitionSource } from "../generate-flow-definition";
import { checkDefinitionSources } from "../schema-consistency";
import { typecheckDefinitionSource } from "../typecheck-definition";

export function registerDefinitionRoutes(server: FastifyInstance): void {
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

    // Stream generation progress as SSE: the loop runs server-side while
    // stage/delta/attempt events are piped to the client, ending with `done`
    // (the full result) or `error`. The client disconnect aborts the loop.
    reply.header("Content-Type", "text/event-stream; charset=utf-8");
    reply.header("Cache-Control", "no-cache, no-transform");
    reply.header("Connection", "keep-alive");
    reply.header("X-Accel-Buffering", "no");

    const stream = new PassThrough();
    let finished = false;
    const send = (event: Record<string, unknown>): void => {
      if (finished || stream.destroyed) return;
      stream.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const abort = new AbortController();
    // A client disconnect mid-write surfaces as a stream error; the abort
    // below is the response, and an unhandled error event would crash the
    // process, so swallow it here.
    stream.on("error", () => {});
    stream.on("close", () => {
      // The reply flushed and ended normally (finished) or the client
      // disconnected mid-generation — abort the loop either way.
      if (!finished) abort.abort();
    });

    void (async () => {
      try {
        const { source, report } = await generateFlowDefinitionSource(
          prompt.trim(),
          { onProgress: (event) => send(event), signal: abort.signal }
        );
        send({ type: "done", source, report });
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Generation failed",
        });
      } finally {
        finished = true;
        stream.end();
      }
    })();

    return reply.send(stream);
  });

  server.post("/api/flows/definitions/author", async (request, reply) => {
    // Creates a flow-authoring session: a hidden flow instance whose ai-chat
    // agent converges on a spec with the user. The session is interactive and
    // stays alive until the user closes it or leaves; the prompt (and optional
    // context, e.g. an existing definition to revise) is recorded in instance
    // state and sent as the first chat message — wrapped in the "no questions"
    // instruction for the I'm-feeling-lucky path.
    const body = request.body as {
      prompt?: string;
      lucky?: boolean;
      context?: string;
    } | null;
    const prompt = body?.prompt;
    if (typeof prompt !== "string" || prompt.trim() === "") {
      return reply.status(400).send({ error: "prompt is required" });
    }

    const persistence = getFlowPersistence();
    if (!persistence) {
      return reply
        .status(500)
        .send({ error: "Flow persistence not available" });
    }

    const lucky = body?.lucky === true;
    const flowId = `author-${randomUUID()}`;
    const runtime = createFlow(flowId, AUTHORING_DEFINITION_ID, persistence);
    const instance = runtime.getWorkflowInstanceEntries()[0];
    if (!instance) {
      return reply
        .status(500)
        .send({ error: "No authoring session instance created" });
    }

    const controller = runtime.getWorkflowInstance(instance.id);
    controller?.patchWorkflowInstanceState({
      prompt: prompt.trim(),
      mode: lucky ? "lucky" : "conversational",
    });
    const taskId = controller?.getState().runningTaskId;
    if (taskId) {
      const context = typeof body?.context === "string" ? body.context : "";
      const firstMessage = lucky
        ? `Produce the complete flow spec now. Do not ask clarifying questions — make reasonable assumptions, call set_flow_spec, then call generate_definition.\n\nRequest: ${prompt.trim()}${context ? `\n\n${context}` : ""}`
        : `${prompt.trim()}${context ? `\n\n${context}` : ""}`;
      controller.sendTaskInput(taskId, firstMessage, "user");
    }

    return reply.status(201).send({
      flowId,
      instanceId: instance.id,
    });
  });

  server.post("/api/flows/definitions/validate", async (request, reply) => {
    // Fastify body is unknown; validated below
    const body = request.body as { source?: string } | null;
    const source = body?.source;
    if (typeof source !== "string" || source.trim() === "") {
      return reply.status(400).send({ error: "source is required" });
    }

    // The same gate generation runs, without registering anything: transpile
    // + load, the schema-consistency check, and the per-definition typecheck.
    try {
      await loadDefinitionFromSource("__validate__", source);
    } catch (err) {
      return reply.send({
        ok: false,
        loadError: err instanceof Error ? err.message : String(err),
        checkErrors: [],
        checkWarnings: [],
        typeErrors: [],
      });
    }
    const check = checkDefinitionSources([{ path: "validated.ts", source }]);
    const typeErrors = typecheckDefinitionSource(source, "__validate__");
    return reply.send({
      ok: check.errors.length === 0 && typeErrors.length === 0,
      checkErrors: check.errors,
      checkWarnings: check.warnings,
      typeErrors,
    });
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
}
