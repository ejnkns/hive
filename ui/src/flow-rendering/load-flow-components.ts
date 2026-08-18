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
  const restores: Array<() => void> = [];

  for (const [componentId, path] of Object.entries(components)) {
    try {
      // Importing the URL serves the transpiled module (its relative imports
      // already rewritten server-side); the ?v= version busts the module
      // cache on every definition save.
      const module = await evaluate(path);
      const factory = module.default;
      if (typeof factory !== "function") continue;
      const registrations = factory(deps);
      registerAll(restores, "components", registrations.components);
      registerAll(restores, "kinds", registrations.kinds);
    } catch (error) {
      // A failed component module (404, network error, syntax) degrades to
      // the generic defaults; log and keep loading the remaining modules.
      console.warn(`Failed to load flow component "${componentId}":`, error);
    }
  }

  return () => {
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
