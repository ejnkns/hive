/** @public — the real FlowComponentDeps composition for the visual matrix:
 * the app's lit runtime plus the injected utility-class stylesheet, exactly
 * as the served host composes them (ui/src/flow-rendering/
 * load-flow-components.ts). The served preset factories receive THIS deps
 * object, so the stories snapshot the components with their production
 * styling. */

import { css, html, LitElement, nothing, svg } from "lit";
import { servedUtilityStyles } from "ui/flow-rendering/served-utility-styles";
import type {
  ElementConstructor,
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";

/** Registration is a hard requirement, not an implementation detail:
 * constructing an unregistered HTMLElement subclass throws "Illegal
 * constructor" (Chrome 152+), so every served class must be defined before
 * any construction — exactly what the served host does
 * (load-flow-components.ts). The tag is only a registration key (stories
 * instantiate via `new`, never parsed from HTML), so a sequence suffix keeps
 * tags unique across the preset modules' classes. */
const definedTags = new WeakMap<ElementConstructor, string>();
let servedElementSequence = 0;

function defineServedElement(element: ElementConstructor): void {
  if (definedTags.has(element)) return;
  const tag = `hive-story-${servedElementSequence}`;
  servedElementSequence += 1;
  customElements.define(tag, element as CustomElementConstructor);
  definedTags.set(element, tag);
}

/** Evaluates a served module's factory and defines EVERY class it returns —
 * the entry composes its shells and surfaces by constructor (flow-component
 * constructs MapShell/TableShell internally), so one story module can drive
 * constructions the factory never handed out by tag. Idempotent per class.
 * Returns the registrations map. */
export function registerServedModule(
  module: (deps: FlowComponentDeps) => FlowComponentRegistrations
): NonNullable<FlowComponentRegistrations["components"]> {
  const components = module(flowDeps).components ?? {};
  for (const element of Object.values(components)) {
    defineServedElement(element);
  }
  return components;
}

/** One served element constructor by registration key (throws on a key typo
 * at story-module scope: the story fails loudly, never silently renders
 * nothing). */
export function servedComponent(
  module: (deps: FlowComponentDeps) => FlowComponentRegistrations,
  key: string
): ElementConstructor {
  const components = registerServedModule(module);
  const element = components[key];
  if (element === undefined) {
    throw new Error(`served component "${key}" not registered`);
  }
  return element;
}

export const flowDeps: FlowComponentDeps = {
  LitElement,
  html,
  css,
  nothing,
  svg,
  utilities: servedUtilityStyles,
};
