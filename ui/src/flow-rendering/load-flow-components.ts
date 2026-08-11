/** @public — loads and registers a definition's served-at-runtime components. */

import { css, html, LitElement, nothing } from "lit";
import type { ElementConstructor } from "./components/dynamic-element-host.ts";
import {
  getComponentRenderer,
  getKindRenderer,
  registerComponentRenderer,
  registerKindRenderer,
  unregisterComponentRenderer,
  unregisterKindRenderer,
} from "./renderer-registry.ts";

// The lit runtime handed to a served component factory. A served module is
// evaluated as a standalone blob module (no imports), so the factory receives
// everything it needs to build Lit custom elements.
export type FlowComponentDeps = {
  LitElement: typeof LitElement;
  html: typeof html;
  css: typeof css;
  nothing: typeof nothing;
};

// The registrations a served component module returns: instance components
// (resolved by WorkflowConfig.ui.instanceComponent) and kind renderers
// (resolved by custom render hints).
export type FlowComponentRegistrations = {
  components?: Record<string, ElementConstructor>;
  kinds?: Record<string, ElementConstructor>;
};

// The served module's contract: a default export factory.
export type FlowComponentModule = {
  default?: (deps: FlowComponentDeps) => FlowComponentRegistrations;
};

// Evaluates a served module's transpiled source into its module record. The
// default implementation imports the source as a blob ESM module (native
// browser behavior); tests inject a fake evaluator since Node's module runner
// cannot import blob URLs.
export type FlowComponentEvaluator = (
  source: string
) => Promise<FlowComponentModule>;

async function evaluateBlobModule(
  source: string
): Promise<FlowComponentModule> {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" })
  );
  try {
    return (await import(/* @vite-ignore */ url)) as FlowComponentModule;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Loads a definition's served component modules (id → fetch path), evaluates
// each, and registers the returned components and kind renderers. Returns a
// cleanup that unregisters exactly what was registered (restoring whatever a
// previous registration held), so switching flows never leaks components. A
// module that fails to load degrades to the generic defaults and is logged.
export async function loadFlowComponents(
  components: Record<string, string>,
  evaluate: FlowComponentEvaluator = evaluateBlobModule
): Promise<() => void> {
  const deps: FlowComponentDeps = { LitElement, html, css, nothing };
  const restores: Array<() => void> = [];

  for (const [componentId, path] of Object.entries(components)) {
    try {
      const response = await fetch(path);
      if (!response.ok) continue;
      const source = await response.text();
      const module = await evaluate(source);
      const factory = module.default;
      if (typeof factory !== "function") continue;
      const registrations = factory(deps);
      registerAll(restores, "components", registrations.components);
      registerAll(restores, "kinds", registrations.kinds);
    } catch (error) {
      // A failed component module degrades to the generic defaults; log and
      // keep loading the remaining modules.
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
