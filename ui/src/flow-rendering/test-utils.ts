import type { LitElement } from "lit";

// Shared helpers for component tests: mount a Lit element into the document,
// settle on its rendered shadow root, and query across nested shadow roots.
// Importing a component module defines its custom element once per test-file
// module graph (vitest isolates files).

export async function mount<T extends LitElement>(element: T): Promise<T> {
  document.body.appendChild(element);
  await element.updateComplete;
  return element;
}

// Waits for every custom element inside a shadow root (and their nested
// children) to finish an update, so assertions see fully-rendered subtrees.
// Lit does not await nested element updates as part of the host's
// updateComplete, so tests settle explicitly.
export async function settle(root: ShadowRoot): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const collect = (el: Element): void => {
    for (const child of el.querySelectorAll("*")) {
      const lit = child as Partial<LitElement>;
      if (lit.updateComplete instanceof Promise) {
        pending.push(lit.updateComplete);
      }
      if (child.shadowRoot !== null)
        collect(child.shadowRoot as unknown as Element);
    }
  };
  collect(root as unknown as Element);
  await Promise.all(pending);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Finds the first element matching selector in a shadow tree, descending into
// nested shadow roots. Root is the host element whose shadow DOM to search.
export function queryDeep(root: LitElement, selector: string): Element | null {
  return queryAllDeep(root, selector)[0] ?? null;
}

// All elements matching selector across a shadow tree, descending into nested
// shadow roots (including light-DOM descendants within a shadow tree) in
// document order.
export function queryAllDeep(root: LitElement, selector: string): Element[] {
  const matches: Element[] = [];
  const walk = (host: Element): void => {
    if (host.shadowRoot === null) return;
    matches.push(...host.shadowRoot.querySelectorAll(selector));
    // querySelectorAll covers the whole shadow tree (light-DOM children
    // included); only shadow hosts open a new boundary to recurse into.
    for (const child of host.shadowRoot.querySelectorAll("*")) {
      if (child.shadowRoot !== null) walk(child);
    }
  };
  walk(root);
  return matches;
}

export function click(): MouseEvent {
  return new MouseEvent("click", { bubbles: true, composed: true });
}

export function type(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

// Test-side non-null accessors: components are asserted to have rendered, so a
// missing element is a test failure worth throwing on (matches the repo's
// no-`!` style).

export function shadowRootOf(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (root === null) {
    throw new Error(
      `Expected ${element.tagName.toLowerCase()} to have a shadow root`
    );
  }
  return root;
}

export function mustQuery(root: ShadowRoot, selector: string): Element {
  const element = root.querySelector(selector);
  if (element === null) {
    throw new Error(`Expected to find "${selector}" in the shadow tree`);
  }
  return element;
}

export function mustFind(root: LitElement, selector: string): Element {
  const element = queryDeep(root, selector);
  if (element === null) {
    throw new Error(`Expected to find "${selector}" in the deep shadow tree`);
  }
  return element;
}
