/** @private — flow-definition REST routes: CRUD, served component source,
 * and the generate/author/validate authoring surface. */

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  saveAuthoringDefinition,
  savePatch,
  seedAuthoringModuleFiles,
  writeAuthoringModuleFile,
} from "../flow-authoring/session.ts";
import { AUTHORING_DEFINITION_ID } from "../flow-authoring.ts";
import {
  analyzeFlowDefinition,
  parseDefinition,
  validateFlowDefinition,
} from "../flow-definition.ts";
import {
  DefinitionAlreadyExistsError,
  deleteUserDefinition,
  getDefinitionComponentSource,
  getRegisteredFlowDefinition,
  listRegisteredDefinitions,
  loadDefinitionFromSource,
  registerUserDefinition,
  updateUserDefinition,
} from "../flow-definitions.ts";
import {
  createFlow,
  getFlowPersistence,
  getFlowRuntime,
} from "../flow-registry.ts";
import { typecheckDefinitionSource } from "../typecheck-definition.ts";

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
      // The pure-data form of a definition module (the builder contract — the
      // editor's Definition tab binds to it).
      definition: record.definition,
      // The referenced file set of a module-set definition (a revision
      // session seeds its editor tabs from these).
      files: record.files,
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

  server.post("/api/flows/definitions/author", async (request, reply) => {
    // Creates a flow-authoring session: a hidden flow instance whose ai-chat
    // agent converges on the definition module with the user. The session is interactive and
    // stays alive until the user closes it or leaves; the prompt (and optional
    // context, e.g. an existing definition to revise) is recorded in instance
    // state and sent as the first chat message — wrapped in the "no questions"
    // instruction for the I'm-feeling-lucky path.
    const body = request.body as {
      prompt?: string;
      lucky?: boolean;
      context?: string;
      // The referenced file set of an existing definition being revised — the
      // session seeds its module-set working directory from these so the file
      // tabs and the read/write tools see the current files.
      files?: Record<string, string>;
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
      // Each session owns a module-set working directory keyed by its flow id:
      // the gate, the file tools, and the editor's file tabs read and write
      // only this session's files.
      moduleSetSlug: flowId,
    });
    // A revision session seeds the existing definition's referenced files so
    // they are visible in the editor tabs and editable in-conversation (hand
    // edits remain authoritative).
    if (
      body?.files !== null &&
      typeof body?.files === "object" &&
      !Array.isArray(body.files) &&
      Object.keys(body.files).length > 0
    ) {
      const seed = seedAuthoringModuleFiles(
        controller?.getState().workflowInstanceState ?? {},
        body.files as Record<string, string>
      );
      if (!seed.ok) {
        return reply.status(400).send({ error: seed.message });
      }
      controller?.patchWorkflowInstanceState({ files: seed.files });
    }
    const taskId = controller?.getState().runningTaskId;
    if (taskId) {
      const context = typeof body?.context === "string" ? body.context : "";
      const firstMessage = lucky
        ? `Produce the complete flow definition module now. Do not ask clarifying questions — make reasonable assumptions, call set_flow_definition, then call validate_definition.\n\nRequest: ${prompt.trim()}${context ? `\n\n${context}` : ""}`
        : `${prompt.trim()}${context ? `\n\n${context}` : ""}`;
      controller.sendTaskInput(taskId, firstMessage, "user");
    }

    return reply.status(201).send({
      flowId,
      instanceId: instance.id,
    });
  });

  // The synchronous save path behind the editor's Save button: runs the same
  // saveAuthoringDefinition core as the agent's save_definition tool (the
  // flow owns the registration; this route just bridges the button to it),
  // patches the instance state, and returns the result immediately — no
  // agent turn. The button lives in the flow-editor's chat area; the agent
  // can also save from chat via the tool.
  server.post(
    "/api/flows/definitions/author/:flowId/save",
    async (request, reply) => {
      // Fastify params type is erased; shape guaranteed by route pattern
      const { flowId } = request.params as { flowId: string };
      const body = request.body as { name?: string } | null;

      const runtime = getFlowRuntime(flowId);
      if (!runtime) {
        return reply.status(404).send({ error: "Flow not found" });
      }
      if (runtime.getFlowConfig().definitionId !== AUTHORING_DEFINITION_ID) {
        return reply.status(404).send({ error: "Flow not found" });
      }
      const instance = runtime.getWorkflowInstanceEntries()[0];
      if (!instance) {
        return reply.status(404).send({ error: "No authoring session" });
      }
      const controller = runtime.getWorkflowInstance(instance.id);
      const state = instance.state.workflowInstanceState;
      try {
        const result = await saveAuthoringDefinition(
          state,
          typeof body?.name === "string" ? body.name : undefined
        );
        controller?.patchWorkflowInstanceState(savePatch(result));
        return reply.send({
          ok: true,
          id: result.id,
          name: result.name,
          checkErrors: result.checkErrors,
          checkWarnings: result.checkWarnings,
        });
      } catch (err) {
        if (err instanceof DefinitionAlreadyExistsError) {
          return reply.status(409).send({ error: err.message });
        }
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Save failed",
        });
      }
    }
  );

  // The write-back behind the flow-editor's editable code pane: the human's
  // current definition module source, patched into the session state — the
  // edit IS the state (one artifact; no divergence flag, no adoption). The
  // agent's tools read the current source, so the next turn builds on the
  // human's edit. The editor debounces its patches; this route is the dumb
  // sync point.
  server.post(
    "/api/flows/definitions/author/:flowId/source",
    async (request, reply) => {
      // Fastify params type is erased; shape guaranteed by route pattern
      const { flowId } = request.params as { flowId: string };
      const body = request.body as { source?: string } | null;

      const runtime = getFlowRuntime(flowId);
      if (!runtime) {
        return reply.status(404).send({ error: "Flow not found" });
      }
      if (runtime.getFlowConfig().definitionId !== AUTHORING_DEFINITION_ID) {
        return reply.status(404).send({ error: "Flow not found" });
      }
      const instance = runtime.getWorkflowInstanceEntries()[0];
      if (!instance) {
        return reply.status(404).send({ error: "No authoring session" });
      }
      const controller = runtime.getWorkflowInstance(instance.id);

      const source = typeof body?.source === "string" ? body.source : "";
      if (source === "") {
        return reply.status(400).send({ error: "source is required" });
      }
      // The parsed definition rides along so the editor's Definition tab
      // binds to the object, not just the literal text.
      let parsedDefinition: unknown;
      try {
        parsedDefinition = parseDefinition(source).definition;
      } catch {
        parsedDefinition = undefined;
      }
      controller?.patchWorkflowInstanceState({ source, parsedDefinition });
      return reply.send({ ok: true });
    }
  );

  // The write-back behind the flow-editor's file tabs: a referenced file of
  // the session's module set, written authoritatively (the file IS the truth —
  // no divergence machinery for files). The same core as the agent's
  // write_definition_file tool; the snapshot carries the updated file set back
  // to the editor.
  server.post(
    "/api/flows/definitions/author/:flowId/files",
    async (request, reply) => {
      // Fastify params type is erased; shape guaranteed by route pattern
      const { flowId } = request.params as { flowId: string };
      const body = request.body as { path?: string; content?: string } | null;

      const runtime = getFlowRuntime(flowId);
      if (!runtime) {
        return reply.status(404).send({ error: "Flow not found" });
      }
      if (runtime.getFlowConfig().definitionId !== AUTHORING_DEFINITION_ID) {
        return reply.status(404).send({ error: "Flow not found" });
      }
      const instance = runtime.getWorkflowInstanceEntries()[0];
      if (!instance) {
        return reply.status(404).send({ error: "No authoring session" });
      }
      const controller = runtime.getWorkflowInstance(instance.id);
      const state = instance.state.workflowInstanceState;
      const result = writeAuthoringModuleFile(
        state,
        typeof body?.path === "string" ? body.path : "",
        typeof body?.content === "string" ? body.content : ""
      );
      if (!result.ok) {
        return reply.status(400).send({ error: result.message });
      }
      controller?.patchWorkflowInstanceState({ files: result.files });
      return reply.send({ ok: true });
    }
  );

  server.post("/api/flows/definitions/validate", async (request, reply) => {
    // Fastify body is unknown; validated below
    const body = request.body as { source?: string } | null;
    const source = body?.source;
    if (typeof source !== "string" || source.trim() === "") {
      return reply.status(400).send({ error: "source is required" });
    }

    // The definition gate runs without registering anything: the loader
    // validates + compiles the module (the runtime surface), the definition
    // validator reports the declared-parts findings, and the per-definition
    // typecheck checks the module against the vocabulary types.
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
    const { definition, findings } = parseDefinition(source);
    const checkErrors = validateFlowDefinition(definition).map(
      (e) => `${e.path}: ${e.message}`
    );
    const checkWarnings = [...analyzeFlowDefinition(definition), ...findings];
    const typeErrors = typecheckDefinitionSource(source, "__validate__");
    return reply.send({
      ok: checkErrors.length === 0 && typeErrors.length === 0,
      checkErrors,
      checkWarnings,
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
    const files =
      body?.files !== null &&
      typeof body?.files === "object" &&
      !Array.isArray(body.files)
        ? (body.files as Record<string, string>)
        : undefined;
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
        files,
      });
      const { definition, findings } = parseDefinition(source);
      return reply.status(201).send({
        ok: true,
        id: record.id,
        name: record.name,
        builtIn: record.builtIn,
        configSchema: record.configSchema,
        // Non-blocking: the definition loads and runs; these are the
        // definition-validator findings (advisory warnings + parse findings)
        // the editor surfaces for the author to fix.
        checkWarnings: [...analyzeFlowDefinition(definition), ...findings],
        checkErrors: validateFlowDefinition(definition).map(
          (e) => `${e.path}: ${e.message}`
        ),
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
    const files =
      body?.files !== null &&
      typeof body?.files === "object" &&
      !Array.isArray(body.files)
        ? (body.files as Record<string, string>)
        : undefined;
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
        files,
      });
      const { definition, findings } = parseDefinition(source);
      return reply.send({
        ok: true,
        id: record.id,
        name: record.name,
        builtIn: record.builtIn,
        configSchema: record.configSchema,
        checkWarnings: [...analyzeFlowDefinition(definition), ...findings],
        checkErrors: validateFlowDefinition(definition).map(
          (e) => `${e.path}: ${e.message}`
        ),
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
