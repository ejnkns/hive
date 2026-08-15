import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { registerBuiltinFlowDefinitions } from "../main/register-builtin-flow-definitions.ts";
import { registerFlowApiRoutes } from "./flow-api-routes.ts";
import {
  getRegisteredFlowDefinition,
  loadUserDefinitionsFromDisk,
  registerFlowDefinition,
  registerUserDefinition,
  resetFlowDefinitionsForTest,
  setDefinitionsBasePathForTest,
} from "./flow-definitions.ts";
import { queenBeeCompiled as queenBeeFlow } from "./test-support/compiled-presets.ts";

const pingFlowSource = `
import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "ping-flow",
  label: "Ping Flow",
  configSchema: [
    { key: "title", label: "Title", type: "string", required: true },
  ],
  workflows: [
    {
      id: "ping",
      label: "Ping",
      instanceState: [],
      initial: "idle",
      terminalStates: ["done"],
      states: [
        { id: "idle", label: "Idle", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`;

describe("flow definition library", () => {
  let baseDir: string;
  let servers: FastifyInstance[];

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "hive-definitions-"));
    setDefinitionsBasePathForTest(baseDir);
    resetFlowDefinitionsForTest();
    servers = [];
    registerFlowDefinition(queenBeeFlow, { builtIn: true });
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
    rmSync(baseDir, { recursive: true, force: true });
  });

  function definitionApiServer(): FastifyInstance {
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);
    return server;
  }

  it("lists the built-in queen-bee definition with its configSchema", async () => {
    const response = await definitionApiServer().inject({
      method: "GET",
      url: "/api/flows/definitions",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    const queenBee = body.definitions.find(
      (d: { id: string }) => d.id === "queen-bee"
    );
    assert.ok(queenBee);
    assert.equal(queenBee.builtIn, true);
    assert.equal(queenBee.name, "Queen Bee");
    assert.deepEqual(queenBee.configSchema, [
      {
        key: "basePath",
        label: "Base path",
        type: "string",
        required: true,
        hint: "A git repository root or a plain directory to bind the flow to.",
      },
    ]);
    assert.equal("source" in queenBee, false);
  });

  it("registers a user definition and serves its source on GET by id", async () => {
    const record = await registerUserDefinition({
      name: "Ping Flow",
      description: "A minimal flow",
      source: pingFlowSource,
    });
    assert.equal(record.id, "ping-flow");

    const server = definitionApiServer();
    const listResponse = await server.inject({
      method: "GET",
      url: "/api/flows/definitions",
    });
    const listed = listResponse
      .json()
      .definitions.find((d: { id: string }) => d.id === "ping-flow");
    assert.ok(listed);
    assert.equal(listed.builtIn, false);
    assert.equal(listed.description, "A minimal flow");
    assert.deepEqual(listed.configSchema, [
      { key: "title", label: "Title", type: "string", required: true },
    ]);
    assert.equal("source" in listed, false);

    const detailResponse = await server.inject({
      method: "GET",
      url: "/api/flows/definitions/ping-flow",
    });
    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.json().source, pingFlowSource);
  });

  it("persists the source to disk so boot loading restores it", async () => {
    await registerUserDefinition({
      name: "Ping Flow",
      source: pingFlowSource,
    });

    const persisted = readFileSync(
      join(baseDir, "definitions", "ping-flow.ts"),
      "utf-8"
    );
    assert.equal(persisted, pingFlowSource);
    const manifest = JSON.parse(
      readFileSync(join(baseDir, "definitions", "manifest.json"), "utf-8")
    ) as Record<string, unknown>;
    assert.equal((manifest["ping-flow"] as { name: string }).name, "Ping Flow");

    await loadUserDefinitionsFromDisk();
    const reloaded = getRegisteredFlowDefinition("ping-flow");
    assert.ok(reloaded);
    assert.equal(reloaded.builtIn, false);
    assert.equal(reloaded.name, "Ping Flow");
  });

  it("skips a definition that fails to transpile during boot loading", async () => {
    mkdirSync(join(baseDir, "definitions"), { recursive: true });
    writeFileSync(
      join(baseDir, "definitions", "broken-flow.ts"),
      "export const flow = {",
      "utf-8"
    );

    await loadUserDefinitionsFromDisk();

    assert.equal(getRegisteredFlowDefinition("broken-flow"), undefined);
    assert.ok(getRegisteredFlowDefinition("queen-bee"));
  });

  it("deletes a user definition and its persisted source", async () => {
    await registerUserDefinition({
      name: "Ping Flow",
      source: pingFlowSource,
    });

    const server = definitionApiServer();
    const deleteResponse = await server.inject({
      method: "DELETE",
      url: "/api/flows/definitions/ping-flow",
    });
    assert.equal(deleteResponse.statusCode, 200);

    const listResponse = await server.inject({
      method: "GET",
      url: "/api/flows/definitions",
    });
    const ids = listResponse
      .json()
      .definitions.map((d: { id: string }) => d.id);
    assert.ok(!ids.includes("ping-flow"));
  });

  it("rejects deleting a built-in definition", async () => {
    const server = definitionApiServer();
    const response = await server.inject({
      method: "DELETE",
      url: "/api/flows/definitions/queen-bee",
    });

    assert.equal(response.statusCode, 409);
    assert.equal(
      response.json().error,
      "Built-in flow definitions cannot be deleted"
    );
  });

  it("returns 404 for an unknown definition id", async () => {
    const server = definitionApiServer();
    const response = await server.inject({
      method: "GET",
      url: "/api/flows/definitions/nope",
    });

    assert.equal(response.statusCode, 404);
  });

  it("built-in (preset) definitions carry their module set like user flows", async () => {
    resetFlowDefinitionsForTest();
    await registerBuiltinFlowDefinitions();
    const queenBee = getRegisteredFlowDefinition("queen-bee");
    assert.ok(queenBee, "queen-bee must register as a built-in");
    assert.equal(queenBee.builtIn, true);
    assert.equal(queenBee.definition?.id, "queen-bee");
    assert.ok(
      typeof queenBee.source === "string" &&
        queenBee.source.includes("export const flow: FlowDefinition = {") &&
        queenBee.source.includes('id: "queen-bee"'),
      "a preset's entry source is the pure-data definition module"
    );
    assert.ok(
      queenBee.files?.["./cards/ops/build-review-package.ts"]?.includes(
        "build_review_packageOperations"
      ),
      "a preset's referenced modules are captured as files"
    );
    assert.ok(
      queenBee.files?.["./tools/update-requirements-draft.ts"] !== undefined,
      "the preset's tools module is part of the file set"
    );
    const wayfinder = getRegisteredFlowDefinition("wayfinder");
    assert.equal(wayfinder?.definition?.id, "wayfinder");
    assert.ok(
      typeof wayfinder?.source === "string" &&
        wayfinder.source.includes("export const flow: FlowDefinition = {") &&
        wayfinder.source.includes('id: "wayfinder"'),
      "wayfinder's source is the pure-data definition module"
    );
    assert.ok(
      wayfinder?.files?.["./charting/ops/settle-chart.ts"] !== undefined,
      "wayfinder's referenced modules are captured as files"
    );
    resetFlowDefinitionsForTest();
  });
});
