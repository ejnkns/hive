/** @public — the flow definition library. Owns the registry, user-definition persistence, and TS loading. */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HIVE_DIR } from "shared/hive-dir";
import type {
  ConfigField,
  FlowDefinition,
} from "workflow-engine/workflow-types";

// ── Types ──

// A registered definition pairs the engine FlowDefinition with the library
// metadata the UI needs. `builtIn` marks definitions shipped by the server
// (not persisted, not deletable); user definitions carry their TS `source`.
export type RegisteredFlowDefinition = {
  id: string;
  name: string;
  description?: string;
  builtIn: boolean;
  configSchema: ConfigField[];
  flow: FlowDefinition;
  source?: string;
};

export type DefinitionManifest = Record<
  string,
  { name: string; description?: string }
>;

// ── Registry ──

const definitions = new Map<string, RegisteredFlowDefinition>();

export function registerFlowDefinition(
  definition: FlowDefinition,
  options: { builtIn?: boolean } = {}
): void {
  definitions.set(definition.id, {
    id: definition.id,
    name: definition.label,
    description: definition.description,
    builtIn: options.builtIn ?? false,
    configSchema: definition.configSchema ?? [],
    flow: definition,
  });
}

export function getRegisteredFlowDefinition(
  id: string
): RegisteredFlowDefinition | undefined {
  return definitions.get(id);
}

// Engine-level lookup used by the flow lifecycle (createFlow / rehydrateFlow).
export function getFlowDefinition(id: string): FlowDefinition | undefined {
  return definitions.get(id)?.flow;
}

export function listRegisteredDefinitions(): RegisteredFlowDefinition[] {
  return Array.from(definitions.values());
}

// ── User-definition registration ──

// Thrown when a definition name slugifies to an id that is already registered.
// Distinct from generic load errors so routes can map it to a 409.
export class DefinitionAlreadyExistsError extends Error {}

export async function registerUserDefinition(input: {
  name: string;
  description?: string;
  source: string;
}): Promise<RegisteredFlowDefinition> {
  const slug = slugify(input.name);
  if (slug === "") {
    throw new Error("Definition name must produce a non-empty slug");
  }
  if (slug === "new") {
    throw new Error('"new" is a reserved flow definition name');
  }
  if (definitions.has(slug)) {
    throw new DefinitionAlreadyExistsError(
      `A flow definition named "${slug}" already exists`
    );
  }

  const flow = await loadDefinitionFromSource(slug, input.source);
  const record: RegisteredFlowDefinition = {
    id: slug,
    name: input.name,
    description: input.description,
    builtIn: false,
    configSchema: flow.configSchema ?? [],
    flow,
    source: input.source,
  };
  definitions.set(slug, record);
  persistUserDefinition(record);
  return record;
}

// Re-registers an existing user definition from edited source. The id (slug)
// is stable — a name change updates the display name only, never the route.
export async function updateUserDefinition(
  id: string,
  input: { name: string; description?: string; source: string }
): Promise<RegisteredFlowDefinition> {
  const existing = definitions.get(id);
  if (!existing) {
    throw new Error(`Flow definition "${id}" not found`);
  }
  if (existing.builtIn) {
    throw new Error("Built-in flow definitions cannot be edited");
  }

  const flow = await loadDefinitionFromSource(id, input.source);
  const record: RegisteredFlowDefinition = {
    id,
    name: input.name,
    description: input.description,
    builtIn: false,
    configSchema: flow.configSchema ?? [],
    flow,
    source: input.source,
  };
  definitions.set(id, record);
  persistUserDefinition(record);
  return record;
}

export function deleteUserDefinition(id: string): void {
  const record = definitions.get(id);
  if (!record) return;
  if (record.builtIn) {
    throw new Error("Built-in flow definitions cannot be deleted");
  }
  definitions.delete(id);
  rmSync(join(definitionsDir(), `${id}.ts`), { force: true });
  const manifest = readManifest();
  delete manifest[id];
  writeManifest(manifest);
}

// ── Boot loading ──

// Loads persisted user definitions from ~/.hive/definitions/ and registers
// each. A definition that fails to transpile is logged and skipped so one bad
// file cannot take down boot.
export async function loadUserDefinitionsFromDisk(): Promise<void> {
  const dir = definitionsDir();
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((entry) => entry.endsWith(".ts"));
  } catch {
    return; // definitions directory does not exist yet
  }

  const manifest = readManifest();
  for (const entry of entries) {
    const slug = entry.replace(/\.ts$/, "");
    try {
      const source = readFileSync(join(dir, entry), "utf-8");
      const flow = await loadDefinitionFromSource(slug, source);
      const meta = manifest[slug];
      definitions.set(slug, {
        id: slug,
        name: meta?.name ?? flow.label ?? slug,
        description: meta?.description ?? flow.description,
        builtIn: false,
        configSchema: flow.configSchema ?? [],
        flow,
        source,
      });
    } catch (err) {
      console.warn(
        `Skipping flow definition "${slug}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

// ── TS loading ──
//
// User definitions are erasable-syntax TypeScript executed by Node's native
// type-stripping (no transpiler dependency). A bare `workflow-engine/*` import
// only resolves from inside the server package, so each definition is
// materialized into an in-package working copy at server/.runtime/definitions/
// before being imported. The durable source stays in ~/.hive/definitions/.
//
// runtimeSlug names the materialized working copy; flowId is the id stamped
// onto the loaded definition (normally equal to the slug, but a rehydrated
// instance snapshot re-stamps the original definition id).
export async function loadDefinitionFromSource(
  runtimeSlug: string,
  source: string,
  flowId: string = runtimeSlug
): Promise<FlowDefinition> {
  const runtimeFile = join(runtimeDefinitionsDir(), `${runtimeSlug}.ts`);
  mkdirSync(runtimeDefinitionsDir(), { recursive: true });
  writeFileSync(runtimeFile, source, "utf-8");

  // The import cache is keyed by URL; the nonce busts it across re-saves.
  const url = `${pathToFileURL(runtimeFile).href}?v=${nextImportNonce()}`;
  const module = (await import(url)) as Record<string, unknown>;
  if (module.flow === null || typeof module.flow !== "object") {
    throw new Error("Definition module must export a `flow` object");
  }
  return { ...(module.flow as FlowDefinition), id: flowId };
}

// ── Persistence ──

let definitionsBasePath = HIVE_DIR;

// Test seam: allows tests to isolate the definitions directory. Production
// callers never invoke this; the default points at ~/.hive (or HIVE_DATA_DIR).
export function setDefinitionsBasePathForTest(basePath: string): void {
  definitionsBasePath = basePath;
}

// Test seam: clears the registry so tests run against a fresh definition
// library. Production callers never invoke this.
export function resetFlowDefinitionsForTest(): void {
  definitions.clear();
}

function definitionsDir(): string {
  return join(definitionsBasePath, "definitions");
}

function manifestPath(): string {
  return join(definitionsDir(), "manifest.json");
}

function persistUserDefinition(record: RegisteredFlowDefinition): void {
  mkdirSync(definitionsDir(), { recursive: true });
  writeFileSync(
    join(definitionsDir(), `${record.id}.ts`),
    record.source ?? "",
    "utf-8"
  );
  const manifest = readManifest();
  manifest[record.id] = {
    name: record.name,
    ...(record.description ? { description: record.description } : {}),
  };
  writeManifest(manifest);
}

function readManifest(): DefinitionManifest {
  try {
    const raw = JSON.parse(readFileSync(manifestPath(), "utf-8")) as unknown;
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as DefinitionManifest;
    }
  } catch {
    // no manifest yet
  }
  return {};
}

function writeManifest(manifest: DefinitionManifest): void {
  mkdirSync(definitionsDir(), { recursive: true });
  writeFileSync(
    manifestPath(),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8"
  );
}

// ── Helpers ──

let importNonce = 0;

// Strictly increasing within the process so every re-import of the same file
// produces a distinct URL and bypasses Node's ESM cache.
function nextImportNonce(): string {
  importNonce += 1;
  return `${Date.now()}-${importNonce}`;
}

// Resolves server/.runtime/ relative to the server package root so it works
// both from source (dev/tests) and from the bundled dist.
function runtimeDefinitionsDir(): string {
  return join(findServerPackageRoot(), ".runtime", "definitions");
}

function findServerPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const packagePath = join(dir, "package.json");
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, "utf-8")) as {
          name?: string;
        };
        if (pkg.name === "server") return dir;
      } catch {
        // malformed package.json — keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("Could not locate the server package root");
    }
    dir = parent;
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
