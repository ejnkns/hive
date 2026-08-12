/** @public — the flow definition library. Owns the registry, user-definition persistence, and TS loading. */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HIVE_DIR } from "shared/hive-dir";
import { logger } from "shared/logger";
import { slugify } from "shared/slugify";
import type {
  ConfigField,
  FlowDefinition,
} from "workflow-engine/workflow-types";
import type { FlowBlueprint } from "./flow-blueprint.ts";

// ── Types ──

// A registered definition pairs the engine FlowDefinition with the library
// metadata the UI needs. `builtIn` marks definitions shipped by the server
// (not persisted, not deletable); `hidden` keeps a definition out of the flow
// library list while remaining instantiable (e.g. the flow-authoring session).
//
// A definition generated from a blueprint with file references is a module
// set: `source` is the entry module (flow.ts) and `files` maps each referenced
// relative path to its source. `blueprint` is the design artifact the set was
// rendered from. Single-file definitions leave both unset.
export type RegisteredFlowDefinition = {
  id: string;
  name: string;
  description?: string;
  builtIn: boolean;
  hidden: boolean;
  configSchema: ConfigField[];
  flow: FlowDefinition;
  source?: string;
  blueprint?: FlowBlueprint;
  files?: Record<string, string>;
};

export type DefinitionManifest = Record<
  string,
  { name: string; description?: string }
>;

// ── Registry ──

const definitions = new Map<string, RegisteredFlowDefinition>();

export function registerFlowDefinition(
  definition: FlowDefinition,
  options: { builtIn?: boolean; hidden?: boolean } = {}
): void {
  definitions.set(definition.id, {
    id: definition.id,
    name: definition.label,
    description: definition.description,
    builtIn: options.builtIn ?? false,
    hidden: options.hidden ?? false,
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
  return Array.from(definitions.values()).filter((d) => !d.hidden);
}

// ── User-definition registration ──

// Thrown when a definition name slugifies to an id that is already registered.
// Distinct from generic load errors so routes can map it to a 409.
export class DefinitionAlreadyExistsError extends Error {}

export async function registerUserDefinition(input: {
  name: string;
  description?: string;
  source: string;
  blueprint?: FlowBlueprint;
  files?: Record<string, string>;
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

  const flow = await loadDefinitionFromSource(
    slug,
    input.source,
    slug,
    input.files
  );
  const record: RegisteredFlowDefinition = {
    id: slug,
    name: input.name,
    description: input.description,
    builtIn: false,
    hidden: false,
    configSchema: flow.configSchema ?? [],
    flow,
    source: input.source,
    blueprint: input.blueprint,
    files: input.files,
  };
  definitions.set(slug, record);
  persistUserDefinition(record);
  return record;
}

// Re-registers an existing user definition from edited source. The id (slug)
// is stable — a name change updates the display name only, never the route.
export async function updateUserDefinition(
  id: string,
  input: {
    name: string;
    description?: string;
    source: string;
    files?: Record<string, string>;
    blueprint?: FlowBlueprint;
  }
): Promise<RegisteredFlowDefinition> {
  const existing = definitions.get(id);
  if (!existing) {
    throw new Error(`Flow definition "${id}" not found`);
  }
  if (existing.builtIn) {
    throw new Error("Built-in flow definitions cannot be edited");
  }

  const flow = await loadDefinitionFromSource(
    id,
    input.source,
    id,
    input.files
  );
  const record: RegisteredFlowDefinition = {
    id,
    name: input.name,
    description: input.description,
    builtIn: false,
    hidden: false,
    configSchema: flow.configSchema ?? [],
    flow,
    source: input.source,
    blueprint: input.blueprint ?? existing.blueprint,
    files: input.files,
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
  rmSync(join(definitionsDir(), id), { recursive: true, force: true });
  const manifest = readManifest();
  delete manifest[id];
  writeManifest(manifest);
}

// ── Served component transpilation ──
//
// Definition-declared components (FlowDefinition.ui.components) are authored
// as erasable-syntax TypeScript modules in the definition source and served to
// the browser as plain ESM JS. Node's type stripping erases type annotations
// and type-only imports without a transpiler dependency; the served module
// must not use value imports (the rendering surface injects its lit runtime
// through the factory argument).

function transpileComponentSource(source: string): string {
  return stripTypeScriptTypes(source);
}

// The transpiled ESM source for a definition's declared component, or
// undefined when the definition (or the component id) is unknown.
export function getDefinitionComponentSource(
  definitionId: string,
  componentId: string
): string | undefined {
  const definition = getFlowDefinition(definitionId);
  const source = definition?.ui?.components?.[componentId];
  if (source === undefined) return undefined;
  return transpileComponentSource(source);
}

// ── Boot loading ──

// Loads persisted user definitions from ~/.hive/definitions/ and registers
// each. A definition that fails to transpile is logged and skipped so one bad
// file cannot take down boot. Single-file definitions live at <id>.ts;
// module-set definitions live in <id>/ (flow.ts + the referenced files).
export async function loadUserDefinitionsFromDisk(): Promise<void> {
  const dir = definitionsDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // definitions directory does not exist yet
  }

  const manifest = readManifest();
  for (const entry of entries) {
    const singleFile = entry.endsWith(".ts") ? entry : undefined;
    const moduleSetDir = !singleFile ? join(dir, entry, "flow.ts") : undefined;
    if (singleFile) {
      const slug = singleFile.replace(/\.ts$/, "");
      try {
        const source = readFileSync(join(dir, singleFile), "utf-8");
        const flow = await loadDefinitionFromSource(slug, source);
        const meta = manifest[slug];
        definitions.set(slug, {
          id: slug,
          name: meta?.name ?? flow.label ?? slug,
          description: meta?.description ?? flow.description,
          builtIn: false,
          hidden: false,
          configSchema: flow.configSchema ?? [],
          flow,
          source,
        });
      } catch (err) {
        logger.warn(
          `Skipping flow definition "${slug}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } else if (moduleSetDir && existsSync(moduleSetDir)) {
      const slug = entry;
      try {
        const files = readDefinitionFiles(join(dir, slug));
        const flow = await loadDefinitionFromSource(
          slug,
          files["flow.ts"] ?? "",
          slug,
          refFilesOf(files)
        );
        const meta = manifest[slug];
        definitions.set(slug, {
          id: slug,
          name: meta?.name ?? flow.label ?? slug,
          description: meta?.description ?? flow.description,
          builtIn: false,
          hidden: false,
          configSchema: flow.configSchema ?? [],
          flow,
          source: files["flow.ts"],
          files: refFilesOf(files),
        });
      } catch (err) {
        logger.warn(
          `Skipping flow definition "${slug}": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
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
// instance snapshot re-stamps the original definition id). When refFiles are
// given, the definition is a module set: the entry is materialized as
// <runtime>/<slug>/flow.ts next to the referenced files and imported.
export async function loadDefinitionFromSource(
  runtimeSlug: string,
  source: string,
  flowId: string = runtimeSlug,
  refFiles?: Record<string, string>
): Promise<FlowDefinition> {
  if (refFiles !== undefined && Object.keys(refFiles).length > 0) {
    const dir = writeModuleSetDir(runtimeSlug, {
      entry: source,
      files: refFiles,
    });
    return importModuleSetEntry(dir, flowId);
  }
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

// ── module-set materialization ──

// Materializes a module set under the runtime definitions directory and
// returns the directory. The entry is always written; a referenced file is
// written only when absent — an existing (implemented) file is authoritative
// (the file IS the truth). References that escape the module-set directory are
// skipped defensively; the structural lint reports them.
export function materializeModuleSet(
  runtimeSlug: string,
  rendered: { entry: string; files: Record<string, string> }
): string {
  const dir = join(runtimeDefinitionsDir(), runtimeSlug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "flow.ts"), rendered.entry, "utf-8");
  for (const [ref, refSource] of Object.entries(rendered.files)) {
    const target = refPathInDir(dir, ref);
    if (target === undefined || existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, refSource, "utf-8");
  }
  return dir;
}

// Imports the entry of an already-materialized module-set directory.
export async function loadModuleSetDefinition(
  dir: string,
  flowId?: string
): Promise<FlowDefinition> {
  const url = `${pathToFileURL(join(dir, "flow.ts")).href}?v=${nextImportNonce()}`;
  const module = (await import(url)) as Record<string, unknown>;
  if (module.flow === null || typeof module.flow !== "object") {
    throw new Error("Definition module must export a `flow` object");
  }
  const flow = module.flow as FlowDefinition;
  return flowId === undefined ? flow : { ...flow, id: flowId };
}

// Imports a module-set entry at <dir>/flow.ts, re-stamping the id.
async function importModuleSetEntry(
  dir: string,
  flowId: string
): Promise<FlowDefinition> {
  const url = `${pathToFileURL(join(dir, "flow.ts")).href}?v=${nextImportNonce()}`;
  const module = (await import(url)) as Record<string, unknown>;
  if (module.flow === null || typeof module.flow !== "object") {
    throw new Error("Definition module must export a `flow` object");
  }
  return { ...(module.flow as FlowDefinition), id: flowId };
}

// Writes a module set (entry + referenced files, write-always) under the
// runtime definitions directory and returns the directory. Used by loading
// and the per-definition typechecker — both check what they are given, not
// what is on disk.
export function writeModuleSetDir(
  runtimeSlug: string,
  rendered: { entry: string; files: Record<string, string> }
): string {
  const dir = join(runtimeDefinitionsDir(), runtimeSlug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "flow.ts"), rendered.entry, "utf-8");
  for (const [ref, refSource] of Object.entries(rendered.files)) {
    const target = refPathInDir(dir, ref);
    if (target === undefined) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, refSource, "utf-8");
  }
  return dir;
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
  const files = record.files;
  if (files !== undefined && Object.keys(files).length > 0) {
    // Module-set definitions persist as a directory: flow.ts (the entry) next
    // to the referenced files, so the entry's relative imports resolve.
    const dir = join(definitionsDir(), record.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "flow.ts"), record.source ?? "", "utf-8");
    for (const [ref, refSource] of Object.entries(files)) {
      const target = refPathInDir(dir, ref);
      if (target === undefined) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, refSource, "utf-8");
    }
  } else {
    writeFileSync(
      join(definitionsDir(), `${record.id}.ts`),
      record.source ?? "",
      "utf-8"
    );
  }
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

// Resolves a referenced path inside a module-set directory, or undefined when
// the ref escapes the directory. The definition root is the containment
// boundary — writes never land outside it (the structural lint reports
// escaping refs; this is the defensive floor).
export function refPathInDir(dir: string, ref: string): string | undefined {
  const target = resolve(join(dir, ref));
  const root = resolve(dir);
  if (target !== root && !target.startsWith(root + sep)) {
    return undefined;
  }
  return target;
}

// Reads every .ts file in a definition directory (flow.ts + referenced files)
// as a relative-path → source map (POSIX separators).
function readDefinitionFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (sub: string): void => {
    for (const entry of readdirSync(sub, { withFileTypes: true })) {
      const full = join(sub, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        files[relative(dir, full).split(sep).join("/")] = readFileSync(
          full,
          "utf-8"
        );
      }
    }
  };
  walk(dir);
  return files;
}

// The referenced files of a read definition directory (flow.ts excluded),
// keyed as declared ref paths (e.g. "./gates/approved.ts").
function refFilesOf(files: Record<string, string>): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const [path, source] of Object.entries(files)) {
    if (path === "flow.ts") continue;
    refs[path.startsWith("./") ? path : `./${path}`] = source;
  }
  return refs;
}

let importNonce = 0;

// Strictly increasing within the process so every re-import of the same file
// produces a distinct URL and bypasses Node's ESM cache.
function nextImportNonce(): string {
  importNonce += 1;
  return `${Date.now()}-${importNonce}`;
}

// Resolves server/.runtime/ relative to the server package root so it works
// both from source (dev/tests) and from the bundled dist. Exported so the
// per-definition typechecker materializes the same working copies the loader
// imports.
export function runtimeDefinitionsDir(): string {
  return join(findServerPackageRoot(), ".runtime", "definitions");
}

// Walks up from the caller to the server package root (package.json name
// "server"), working from source (dev/tests) and from the bundled dist.
// Exported so the per-definition typechecker resolves the server tsconfig
// the same way in both.
export function findServerPackageRoot(): string {
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
