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
import { createFlowRuntime } from "workflow-engine/create-flow-runtime";
import { registerBuiltinFlowDefinitions } from "../main/register-builtin-flow-definitions.ts";
import { registerFlowApiRoutes } from "./flow-api-routes.ts";
import {
  definitionModuleVersion,
  getRegisteredFlowDefinition,
  loadUserDefinitionsFromDisk,
  registerFlowDefinition,
  registerUserDefinition,
  resetFlowDefinitionsForTest,
  setDefinitionsBasePathForTest,
} from "./flow-definitions.ts";
import {
  registerFlowForTest,
  resetFlowRuntimesForTest,
} from "./flow-registry.ts";
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
    resetFlowRuntimesForTest();
    servers = [];
    registerFlowDefinition(queenBeeFlow, { builtIn: true });
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
    resetFlowRuntimesForTest();
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

describe("definition module version determinism", () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  function definitionApiServer(): FastifyInstance {
    const server = Fastify();
    servers.push(server);
    registerFlowApiRoutes(server);
    return server;
  }

  // A save-unaware module: the version must depend only on the source and
  // the referenced file contents — never on call order, key order, or any
  // other ambient state — so an unchanged definition always loads with the
  // same `?v=` and a save yields a new one.
  const versionedSource = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "versioned-probe",
  label: "Versioned Probe",
  configSchema: [],
  ui: {
    components: {
      "probe-card": { ref: "./ui/probe-card.ts" },
    },
  },
  workflows: [
    {
      id: "probe",
      label: "Probe",
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

  const versionedFiles = {
    "./ui/probe-card.ts":
      'import { theme } from "./theme.ts";\n\nexport default function (lit: FlowComponentDeps) { return { components: {} }; }\n',
    "./ui/theme.ts":
      'import { token } from "./tokens.ts";\nexport const theme = token;\n',
    "./ui/tokens.ts": 'export const token = "mountain";\n',
  };

  it("hashes identical content to the same version regardless of file key order", () => {
    const first = definitionModuleVersion(versionedSource, versionedFiles);
    assert.match(first, /^[0-9a-f]{16}$/);
    assert.equal(
      definitionModuleVersion(versionedSource, versionedFiles),
      first,
      "recomputing with the same inputs yields the same version"
    );
    const reordered = {
      "./ui/tokens.ts": versionedFiles["./ui/tokens.ts"],
      "./ui/probe-card.ts": versionedFiles["./ui/probe-card.ts"],
      "./ui/theme.ts": versionedFiles["./ui/theme.ts"],
    };
    assert.equal(
      definitionModuleVersion(versionedSource, reordered),
      first,
      "a re-loaded definition whose files arrive in a different key order keeps its version"
    );
    assert.equal(
      definitionModuleVersion(versionedSource, undefined),
      definitionModuleVersion(versionedSource, undefined)
    );
  });

  it("changes the version when the source or a file entry changes", () => {
    const base = definitionModuleVersion(versionedSource, versionedFiles);
    assert.notEqual(
      definitionModuleVersion(
        `${versionedSource}\n// edited\n`,
        versionedFiles
      ),
      base,
      "a source edit yields a new version"
    );
    assert.notEqual(
      definitionModuleVersion(versionedSource, {
        ...versionedFiles,
        "./ui/theme.ts": 'export const theme = "light";\n',
      }),
      base,
      "an edited referenced file yields a new version"
    );
    assert.notEqual(
      definitionModuleVersion(versionedSource, {
        "./ui/probe-card.ts": versionedFiles["./ui/probe-card.ts"],
      }),
      base,
      "a removed referenced file yields a new version"
    );
    assert.notEqual(
      definitionModuleVersion(versionedSource, {
        ...versionedFiles,
        "./ui/tokens-extra.ts": "export const extra = true;\n",
      }),
      base,
      "an added referenced file yields a new version"
    );
  });

  it("versions the payload and module routes through the same shared function", async () => {
    await registerUserDefinition({
      name: "Versioned Probe",
      source: versionedSource,
      files: versionedFiles,
    });
    const expected = definitionModuleVersion(versionedSource, versionedFiles);

    const runtime = createFlowRuntime(
      "versioned-probe-run",
      [],
      [],
      {},
      { name: "Versioned Run", definitionId: "versioned-probe" },
      {}
    );
    registerFlowForTest("versioned-probe-run", runtime);
    const server = definitionApiServer();

    // The payload builder (flow-payload.ts) stamps the ref-form component
    // URL with the seam's version.
    const flowsResponse = await server.inject({
      method: "GET",
      url: "/api/flows",
    });
    assert.equal(flowsResponse.statusCode, 200);
    const flow = flowsResponse
      .json()
      .flows.find(
        (entry: { id: string }) => entry.id === "versioned-probe-run"
      );
    assert.ok(flow);
    assert.equal(
      flow.ui.components["probe-card"],
      `/api/flows/definitions/versioned-probe/components/probe-card?v=${expected}`,
      "the payload versions ref-form component URLs with the shared content hash"
    );

    // The components route (definition-routes.ts) recomputes the version
    // through the same seam when rewriting the entry's relative imports.
    const entryResponse = await server.inject({
      method: "GET",
      url: "/api/flows/definitions/versioned-probe/components/probe-card",
    });
    assert.equal(entryResponse.statusCode, 200);
    assert.ok(
      entryResponse.body.includes(
        `/api/flows/definitions/versioned-probe/modules/ui/theme.ts?v=${expected}`
      ),
      "the components route rewrites imports with the shared content hash"
    );

    // The modules route (definition-routes.ts) computes the version the same
    // way for a referenced file that imports a sibling.
    const themeResponse = await server.inject({
      method: "GET",
      url: "/api/flows/definitions/versioned-probe/modules/ui/theme.ts",
    });
    assert.equal(themeResponse.statusCode, 200);
    assert.ok(
      themeResponse.body.includes(
        `/api/flows/definitions/versioned-probe/modules/ui/tokens.ts?v=${expected}`
      ),
      "the modules route rewrites imports with the shared content hash"
    );
  });
});
