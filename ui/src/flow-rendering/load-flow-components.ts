/** @public — loads and registers a definition's served-at-runtime components. */

import { css, html, LitElement, nothing, svg } from "lit";
import type {
  ElementConstructor,
  FlowComponentDeps,
  FlowComponentModule,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";
import {
  getComponentRenderer,
  getKindRenderer,
  registerComponentRenderer,
  registerKindRenderer,
  unregisterComponentRenderer,
  unregisterKindRenderer,
} from "./renderer-registry.ts";

// The served-module contract types now live in the engine (the allowlist the
// module-set gate typechecks component files against); the UI re-exports them
// unchanged so the rendering surface keeps one import surface.
export type {
  ElementConstructor,
  FlowComponentDeps,
  FlowComponentModule,
  FlowComponentRegistrations,
};

// Evaluates a served module's module URL into its module record. The default
// implementation imports the module over HTTP: a served module's rewritten
// relative imports are path-only absolute URLs (e.g.
// `/api/flows/definitions/<id>/modules/ui/helper.ts?v=<hash>`), which need a
// hierarchical base URL to resolve — a blob module's base is a
// non-hierarchical blob: URL, so the entry cannot be blob-evaluated once it
// imports siblings. Tests inject a fake evaluator since Node's module runner
// cannot import HTTP URLs.
export type FlowComponentEvaluator = (
  moduleUrl: string
) => Promise<FlowComponentModule>;

async function evaluateModuleByUrl(
  moduleUrl: string
): Promise<FlowComponentModule> {
  return (await import(/* @vite-ignore */ moduleUrl)) as FlowComponentModule;
}

// Loads a definition's served component modules (id → fetch path), evaluates
// each, and registers the returned components and kind renderers. Returns a
// cleanup that unregisters exactly what was registered (restoring whatever a
// previous registration held), so switching flows never leaks components. A
// module that fails to load degrades to the generic defaults and is logged.
export async function loadFlowComponents(
  components: Record<string, string>,
  evaluate: FlowComponentEvaluator = evaluateModuleByUrl
): Promise<() => void> {
  const deps: FlowComponentDeps = { LitElement, html, css, nothing, svg };
  const cleanups: Array<() => void> = [];

  for (const [componentId, path] of Object.entries(components)) {
    const cleanup = await loadServedPath({ componentId, path, evaluate, deps });
    if (cleanup !== undefined) cleanups.push(cleanup);
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

// The evaluated served-module cache, keyed by the versioned fetch path (the
// `?v=` hash rides in the path). A module-scope map: re-loading the same
// version is a no-op — the same classes are returned, never re-evaluated —
// so the renderer registry never sees a new identity for the same version
// and the mounted surface survives data churn. Only a version change (a
// definition save bumps `?v=`) is a new cache key and re-evaluates.
type ServedModuleCacheEntry = {
  // The factory result: the component/kinds classes keyed by registration
  // key. The classes are cached, not just the module, because served
  // factories define their classes inside the factory body — re-invoking a
  // cached module would mint fresh classes and churn every mounted element.
  components: Record<string, ElementConstructor> | undefined;
  kinds: Record<string, ElementConstructor> | undefined;
  // Live loads sharing this entry; the underlying restores run only when the
  // last share is released, so an overlapping load (the reload race) is never
  // unregistered by a sibling cleanup.
  refcount: number;
};

const servedModuleCache = new Map<string, ServedModuleCacheEntry>();

// Loads one served module path and registers its components/kinds. The
// evaluated factory result is cached per versioned path; the returned cleanup
// releases this load's share of the cache entry.
async function loadServedPath({
  componentId,
  path,
  evaluate,
  deps,
}: {
  componentId: string;
  path: string;
  evaluate: FlowComponentEvaluator;
  deps: FlowComponentDeps;
}): Promise<(() => void) | undefined> {
  const cached = servedModuleCache.get(path);
  if (cached !== undefined) {
    cached.refcount += 1;
    return releaseAfter(cached, registerFromCache(cached));
  }

  let registrations: FlowComponentRegistrations;
  try {
    // Importing the URL serves the transpiled module (its relative imports
    // already rewritten server-side); the ?v= version busts the module
    // cache on every definition save.
    const module = await evaluate(path);
    const factory = module.default;
    if (typeof factory !== "function") return undefined;
    registrations = factory(deps);
  } catch (error) {
    // A failed component module (404, network error, syntax) degrades to
    // the generic defaults; log and keep loading the remaining modules.
    console.warn(`Failed to load flow component "${componentId}":`, error);
    return undefined;
  }

  const entry: ServedModuleCacheEntry = {
    components: registrations.components,
    kinds: registrations.kinds,
    refcount: 1,
  };
  servedModuleCache.set(path, entry);
  return releaseAfter(entry, registerFromCache(entry));
}

// Registers a cache entry's classes and builds the per-key restores. Cache
// hits re-register the same classes — the registry keeps the same identity,
// so no mounted element is recreated — with fresh prior-capture, so
// sequential load/unload keeps its stack semantics.
function registerFromCache(entry: ServedModuleCacheEntry): Array<() => void> {
  const restores: Array<() => void> = [];
  registerAll(restores, "components", entry.components);
  registerAll(restores, "kinds", entry.kinds);
  return restores;
}

// A cleanup for one load's share of a cache entry: releases exactly once,
// decrementing the refcount, and runs the underlying per-key restores only
// when the last share releases.
function releaseAfter(
  entry: ServedModuleCacheEntry,
  restores: Array<() => void>
): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.refcount -= 1;
    if (entry.refcount > 0) return;
    for (const restore of restores) restore();
  };
}

function registerAll(
  restores: Array<() => void>,
  kind: "components" | "kinds",
  registrations: Record<string, ElementConstructor> | undefined
): void {
  if (registrations === undefined) return;
  for (const [key, element] of Object.entries(registrations)) {
    // Browser registration is a hard requirement, not an implementation
    // detail: constructing an unregistered HTMLElement subclass throws
    // "Illegal constructor". The default components are defined at module
    // import; served classes must be defined here or dynamic-element-host's
    // `new elementClass()` would fail at mount time.
    const tag = defineServedElement(element);
    const prior =
      kind === "components" ? getComponentRenderer(key) : getKindRenderer(key);
    if (kind === "components") registerComponentRenderer(key, element);
    else registerKindRenderer(key, element);
    restores.push(() => {
      undefineServedElement(tag);
      // Only undo this element's own registration: an overlapping load (the
      // reload race — the host disposes a stale load whose restore runs after
      // a newer load registered the same key) must not clobber the newer
      // element. The registry's current holder is authoritative — if it is
      // still this element, undo (or restore the prior); otherwise a newer
      // registration owns the key and this stale cleanup leaves it alone.
      const current =
        kind === "components"
          ? getComponentRenderer(key)
          : getKindRenderer(key);
      if (current !== element) return;
      if (prior === undefined) {
        if (kind === "components") unregisterComponentRenderer(key);
        else unregisterKindRenderer(key);
      } else if (kind === "components") {
        registerComponentRenderer(key, prior);
      } else {
        registerKindRenderer(key, prior);
      }
    });
  }
}

// The tag is only a registration key — served elements are instantiated via
// `new`, never parsed from HTML — so a sequence suffix keeps tags unique
// across flows and class replacements.
const definedTags = new WeakMap<ElementConstructor, string>();
let servedElementSequence = 0;

function defineServedElement(element: ElementConstructor): string {
  const existing = definedTags.get(element);
  if (existing !== undefined) return existing;
  const tag = `hive-served-${servedElementSequence}`;
  servedElementSequence += 1;
  customElements.define(tag, element as CustomElementConstructor);
  definedTags.set(element, tag);
  return tag;
}

function undefineServedElement(tag: string): void {
  // undoDefine is not available in older browsers; without it the tag stays
  // registered (harmless — each registration defines a distinct class).
  const registry = customElements as CustomElementRegistry & {
    undoDefine?: (name: string) => void;
  };
  registry.undoDefine?.(tag);
}
