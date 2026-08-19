/** @public — the flow definition library. Owns the registry, user-definition persistence, and TS loading. */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HIVE_DIR } from "shared/hive-dir";
import { logger } from "shared/logger";
import { slugify } from "shared/slugify";
import ts from "typescript";
import {
  collectDefinitionRefs,
  compileFlowDefinition,
} from "workflow-engine/compile-flow-definition";
import type {
  CompiledFlowDefinition,
  ConfigField,
  FlowDefinition,
  FlowThemeSpec,
} from "workflow-engine/workflow-types";
import { validateFlowDefinition } from "./flow-definition.ts";

// ── Types ──

// A registered definition pairs the compiled runtime projection (what the
// engine executes) with the library metadata the UI needs. `builtIn` marks
// definitions shipped by the server (not persisted, not deletable); `hidden`
// keeps a definition out of the flow library list while remaining
// instantiable (e.g. the flow-authoring session).
//
// A definition with file references is a module set: `source` is the entry
// module (flow.ts) and `files` maps each referenced relative path to its
// source. `definition` is the pure-data form a data module carries (the
// editor/builder bind to it); `flow` is the compiled projection the runtime
// executes.
export type RegisteredFlowDefinition = {
  id: string;
  name: string;
  description?: string;
  builtIn: boolean;
  hidden: boolean;
  configSchema: ConfigField[];
  flow: CompiledFlowDefinition;
  // The pure-data form of a definition module (the builder contract).
  definition?: FlowDefinition;
  source?: string;
  files?: Record<string, string>;
};

// What loading a definition module produces: the compiled runtime projection
// plus — when the module is a data definition — the pure-data form itself
// (the editor binds to it; the runtime keeps both so the projection can be
// rebuilt deterministically).
export type LoadedDefinition = {
  flow: CompiledFlowDefinition;
  definition?: FlowDefinition;
};

export type DefinitionManifest = Record<
  string,
  { name: string; description?: string }
>;

// ── Registry ──

const definitions = new Map<string, RegisteredFlowDefinition>();

export function registerFlowDefinition(
  definition: CompiledFlowDefinition,
  options: {
    builtIn?: boolean;
    hidden?: boolean;
    // The module set of a built-in/preset flow (its entry source + referenced
    // files), so built-ins are defined the same way user-generated flows are —
    // viewable from the library instead of a dead edit button.
    source?: string;
    files?: Record<string, string>;
    // The pure-data form of a data definition module.
    definition?: FlowDefinition;
  } = {}
): void {
  definitions.set(definition.id, {
    id: definition.id,
    name: definition.label,
    description: definition.description,
    builtIn: options.builtIn ?? false,
    hidden: options.hidden ?? false,
    configSchema: definition.configSchema ?? [],
    flow: definition,
    definition: options.definition,
    source: options.source,
    files: options.files,
  });
}

export function getRegisteredFlowDefinition(
  id: string
): RegisteredFlowDefinition | undefined {
  return definitions.get(id);
}

// Engine-level lookup used by the flow lifecycle (createFlow / rehydrateFlow).
export function getFlowDefinition(
  id: string
): CompiledFlowDefinition | undefined {
  return definitions.get(id)?.flow;
}

export function listRegisteredDefinitions(): RegisteredFlowDefinition[] {
  return Array.from(definitions.values()).filter((d) => !d.hidden);
}

// A definition's declarative theme tokens (ui.theme). The pure-data form wins
// (the authoring contract a data module carries); module-set flows with no
// pure-data form fall back to the compiled projection — the compile step
// passes ui through unchanged, so both carry the same values. One source of
// truth per flow.
export function getFlowTheme(id: string): FlowThemeSpec | undefined {
  const record = definitions.get(id);
  return record?.definition?.ui?.theme ?? record?.flow.ui?.theme;
}

// ── User-definition registration ──

// Thrown when a definition name slugifies to an id that is already registered.
// Distinct from generic load errors so routes can map it to a 409.
export class DefinitionAlreadyExistsError extends Error {}

export async function registerUserDefinition(input: {
  name: string;
  description?: string;
  source: string;
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

  const loaded = await loadDefinitionFromSource(
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
    configSchema: loaded.flow.configSchema ?? [],
    flow: loaded.flow,
    definition: loaded.definition,
    source: input.source,
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
  }
): Promise<RegisteredFlowDefinition> {
  const existing = definitions.get(id);
  if (!existing) {
    throw new Error(`Flow definition "${id}" not found`);
  }
  if (existing.builtIn) {
    throw new Error("Built-in flow definitions cannot be edited");
  }

  const loaded = await loadDefinitionFromSource(
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
    configSchema: loaded.flow.configSchema ?? [],
    flow: loaded.flow,
    definition: loaded.definition,
    source: input.source,
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

// ── Served module transpilation and versioning ──
//
// Definition-declared components (FlowDefinition.ui.components) are authored
// as erasable-syntax TypeScript modules in the definition source and served to
// the browser as plain ESM JS. Node's type stripping erases type annotations
// and type-only imports without a transpiler dependency; the rendering
// surface injects its lit runtime through the factory argument, and a
// ref-form component's relative imports resolve over HTTP from the
// module-set file route (no bundler, no import map).

function transpileComponentSource(source: string): string {
  return stripTypeScriptTypes(source);
}

// The stateless version of a definition's module set (the entry module plus
// its referenced files): a content hash that rides in served-module URLs as
// `?v=…`. One shared function — the payload builder and the serve routes
// compute the same version, so a definition save changes every URL and busts
// the browser module cache. No revision state is persisted.
export function definitionModuleVersion(
  source: string,
  files: Record<string, string> | undefined
): string {
  const hash = createHash("sha256");
  hash.update(source);
  // File entries hash in sorted path order: the map's key order is
  // caller-dependent (a JSON body keeps the client's insertion order, a
  // directory read follows readdir order), so identical content must hash
  // the same no matter how the keys arrived — the version changes only when
  // the definition actually changes, not when it is re-loaded or re-saved
  // with the same files in a different order.
  const entries = Object.entries(files ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  for (const [path, fileSource] of entries) {
    hash.update(path);
    hash.update(fileSource);
  }
  return hash.digest("hex").slice(0, 16);
}

// The transpiled ESM source for a definition's declared component, or
// undefined when the definition (or the component id) is unknown. An inline
// source string keeps the legacy single-blob route (transpiled, never
// rewritten — the inline form does not support imports); a ref-form component
// ({ ref }) resolves the file from the definition's module-set file map (the
// same authority the editor tabs and the refs endpoint derive from) and
// serves it as a module-graph entry: relative imports rewritten to absolute
// versioned URLs.
export function getDefinitionComponentSource(
  definitionId: string,
  componentId: string,
  version: string
): string | undefined {
  const record = definitions.get(definitionId);
  const spec =
    record?.definition?.ui?.components?.[componentId] ??
    record?.flow.ui?.components?.[componentId];
  if (typeof spec === "string") return transpileComponentSource(spec);
  if (spec === undefined) return undefined;
  return getDefinitionModuleSource(definitionId, spec.ref, version);
}

// The transpiled ESM source for a module-set file (a component entry or any
// referenced file), with relative import specifiers rewritten to absolute
// versioned URLs, or undefined when the definition or the file is unknown.
// The module-set file map (record.files) is the authority — the same one the
// editor tabs and the refs endpoint derive from.
export function getDefinitionModuleSource(
  definitionId: string,
  filePath: string,
  version: string
): string | undefined {
  const files = definitions.get(definitionId)?.files;
  if (files === undefined) return undefined;
  const key = filePath.startsWith("./") ? filePath : `./${filePath}`;
  // The exact file first, then the `.ts` extension — the module-set typecheck
  // (bundler resolution) also resolves an extensionless relative import, so
  // serving resolves it the same way.
  const source =
    files[key] ??
    files[filePath] ??
    files[`${key}.ts`] ??
    files[`${filePath}.ts`];
  if (source === undefined) return undefined;
  return transpileModuleFileSource(source, key, definitionId, version);
}

// Node type stripping plus the relative-specifier rewrite. The rewrite runs
// on the original source (its positions come from that parse) before the
// type-only syntax is erased.
function transpileModuleFileSource(
  source: string,
  filePath: string,
  definitionId: string,
  version: string
): string {
  return stripTypeScriptTypes(
    rewriteRelativeImports(source, filePath, definitionId, version)
  );
}

// Rewrites relative import specifiers (`./`, `../`) in a served module's
// source to absolute versioned URLs:
// `/api/flows/definitions/<id>/modules/<file>?v=<version>`. Bare specifiers
// are left untouched — they are reserved for the future import-map rung, so
// the two layers compose. A rewritten module tree resolves over HTTP with no
// bundler and no import map: the client still blob-evaluates each entry, and
// only its rewritten imports resolve against the module-set file route.
function rewriteRelativeImports(
  source: string,
  filePath: string,
  definitionId: string,
  version: string
): string {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const baseUrl = `/api/flows/definitions/${encodeURIComponent(definitionId)}/modules/`;
  const dir = posix.dirname(filePath);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const specifier of relativeSpecifierLiterals(sourceFile)) {
    if (!specifier.text.startsWith("./") && !specifier.text.startsWith("../")) {
      continue;
    }
    const resolved = posix.normalize(posix.join(dir, specifier.text));
    if (resolved === "." || resolved.startsWith("..")) continue;
    const url =
      baseUrl +
      resolved
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/") +
      `?v=${version}`;
    replacements.push({
      start: specifier.start,
      end: specifier.end,
      text: JSON.stringify(url),
    });
  }
  let rewritten = source;
  // Apply the replacements from last position to first so the earlier offsets
  // stay valid against the not-yet-edited prefix.
  for (const replacement of replacements.reverse()) {
    rewritten =
      rewritten.slice(0, replacement.start) +
      replacement.text +
      rewritten.slice(replacement.end);
  }
  return rewritten;
}

// The string-literal import specifiers of a module — static imports,
// re-exports, side-effect imports, and dynamic import() calls — with their
// source positions (the rewriter needs exact offsets into the raw source).
function relativeSpecifierLiterals(
  sourceFile: ts.SourceFile
): Array<{ start: number; end: number; text: string }> {
  const specifiers: Array<{
    start: number;
    end: number;
    text: string;
  }> = [];
  const visit = (node: ts.Node): void => {
    let literal: ts.StringLiteral | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        literal = node.moduleSpecifier;
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) literal = arg;
    }
    if (literal !== undefined) {
      specifiers.push({
        start: literal.getStart(sourceFile),
        end: literal.end,
        text: literal.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
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
        const loaded = await loadDefinitionFromSource(slug, source);
        const meta = manifest[slug];
        definitions.set(slug, {
          id: slug,
          name: meta?.name ?? loaded.flow.label ?? slug,
          description: meta?.description ?? loaded.flow.description,
          builtIn: false,
          hidden: false,
          configSchema: loaded.flow.configSchema ?? [],
          flow: loaded.flow,
          definition: loaded.definition,
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
        const loaded = await loadDefinitionFromSource(
          slug,
          files["flow.ts"] ?? "",
          slug,
          refFilesOf(files)
        );
        const meta = manifest[slug];
        definitions.set(slug, {
          id: slug,
          name: meta?.name ?? loaded.flow.label ?? slug,
          description: meta?.description ?? loaded.flow.description,
          builtIn: false,
          hidden: false,
          configSchema: loaded.flow.configSchema ?? [],
          flow: loaded.flow,
          definition: loaded.definition,
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
// The loader seam: import the definition module → validate (a data module's
// declared parts are decidable) → compile (compileFlowDefinition with a ref
// resolver that imports the referenced modules) → the compiled projection the
// runtime executes. A legacy closure-form module (hand-authored compiled) is
// used directly — the runtime contract never changed, only the authoring seam
// did.
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
): Promise<LoadedDefinition> {
  const form = await importDefinitionModule(runtimeSlug, source, refFiles);
  // The definition is the only artifact: a module must be a pure-data
  // definition. The closure-form compiled module (gates/transforms as
  // closures, ops/tools by name) is retired — the authored surface, presets,
  // and the gate all write the data form.
  if (!isDefinitionData(form)) {
    throw new Error(
      "Definition module is not pure data — every workflow must declare instanceState (the closure-form module is no longer supported)"
    );
  }
  const dir =
    refFiles !== undefined && Object.keys(refFiles).length > 0
      ? writeModuleSetDir(runtimeSlug, { entry: source, files: refFiles })
      : undefined;
  return compileDataDefinition(form, flowId, dir);
}

// Whether an imported module's `flow` export is a pure-data definition (every
// workflow declares instanceState — the data vocabulary's required anchor). A
// closure-form compiled workflow never carries instanceState (it uses the
// erased workflowInstanceState anchor instead), so the check is unambiguous.
function isDefinitionData(form: unknown): form is FlowDefinition {
  if (typeof form !== "object" || form === null) return false;
  const workflows = (form as { workflows?: unknown }).workflows;
  if (!Array.isArray(workflows) || workflows.length === 0) return false;
  return workflows.every(
    (wf) =>
      typeof wf === "object" &&
      wf !== null &&
      Array.isArray((wf as { instanceState?: unknown }).instanceState)
  );
}

// Imports the definition module (materializing the module set when refs are
// given) and returns its `flow` export.
async function importDefinitionModule(
  runtimeSlug: string,
  source: string,
  refFiles?: Record<string, string>
): Promise<unknown> {
  if (refFiles !== undefined && Object.keys(refFiles).length > 0) {
    const dir = writeModuleSetDir(runtimeSlug, {
      entry: source,
      files: refFiles,
    });
    return importModuleSetEntry(dir);
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
  return module.flow;
}

// The data-definition compile: validate the declared parts, import every
// referenced module (refs are by path — the definition itself imports
// nothing), and compile to the runtime projection. `dir` is the materialized
// module-set root the refs resolve against (undefined for a single-file
// definition with no refs).
async function compileDataDefinition(
  definition: FlowDefinition,
  flowId: string,
  dir: string | undefined
): Promise<LoadedDefinition> {
  const errors = validateFlowDefinition(definition);
  if (errors.length > 0) {
    throw new Error(
      `Flow definition validation failed:\n${errors
        .map((e) => `  ${e.path}: ${e.message}`)
        .join("\n")}`
    );
  }

  const modules = new Map<string, Record<string, unknown>>();
  for (const { ref } of collectDefinitionRefs(definition)) {
    if (modules.has(ref)) continue;
    if (dir === undefined) {
      throw new Error(
        `Reference ${ref} cannot resolve — a definition with file references must be saved with its referenced files`
      );
    }
    const target = refPathInDir(dir, ref);
    if (target === undefined) {
      throw new Error(
        `Reference ${ref} is outside the definition root — reference paths must stay inside the module-set directory`
      );
    }
    const url = `${pathToFileURL(target).href}?v=${nextImportNonce()}`;
    const module = (await import(url)) as Record<string, unknown>;
    modules.set(ref, module);
  }
  const compiled = compileFlowDefinition(
    definition,
    (ref) => modules.get(ref) ?? {}
  );
  return { flow: { ...compiled, id: flowId }, definition };
}

// Imports a module-set entry at <dir>/flow.ts (the raw module.flow — the
// compiled projection for a rendered closure-form entry).
async function importModuleSetEntry(
  dir: string
): Promise<CompiledFlowDefinition> {
  const url = `${pathToFileURL(join(dir, "flow.ts")).href}?v=${nextImportNonce()}`;
  const module = (await import(url)) as Record<string, unknown>;
  if (module.flow === null || typeof module.flow !== "object") {
    throw new Error("Definition module must export a `flow` object");
  }
  return module.flow as CompiledFlowDefinition;
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
