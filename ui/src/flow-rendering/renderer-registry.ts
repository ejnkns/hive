/** @private — maps render kinds and component ids to Lit element classes. */

import type { LitElement } from "lit";

export type ElementConstructor = typeof LitElement;

const kindRenderers = new Map<string, ElementConstructor>();
const componentRenderers = new Map<string, ElementConstructor>();

export function registerKindRenderer(
  kind: string,
  element: ElementConstructor
): void {
  kindRenderers.set(kind, element);
}

export function registerComponentRenderer(
  componentId: string,
  element: ElementConstructor
): void {
  componentRenderers.set(componentId, element);
}

export function getKindRenderer(kind: string): ElementConstructor | undefined {
  return kindRenderers.get(kind);
}

export function getComponentRenderer(
  componentId: string | undefined
): ElementConstructor | undefined {
  if (componentId === undefined) return undefined;
  return componentRenderers.get(componentId);
}
