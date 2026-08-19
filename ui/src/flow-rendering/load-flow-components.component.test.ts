import { html, LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowInstances } from "./components/workflow-instances.ts";
import { defineFlowRenderingComponents } from "./define-components.ts";
import {
  type FlowComponentDeps,
  type FlowComponentEvaluator,
  type FlowComponentModule,
  loadFlowComponents,
} from "./load-flow-components.ts";
import { getComponentRenderer } from "./renderer-registry.ts";
import { cardDef, entry } from "./test-fixtures.ts";
import { mount, mustFind, settle, shadowRootOf } from "./test-utils.ts";

// The served-module contract: a default factory receiving the app's lit
// runtime. The fake evaluator below supplies a real class, so the registration
// and rendering paths run against actual Lit elements (blob ESM imports are
// not importable under Node's module runner, which is why the evaluator is a
// seam in the loader rather than the blob import itself).
class DemoCard extends LitElement {
  static properties = {
    workflowDef: { attribute: false },
    instanceEntry: { attribute: false },
  };
  workflowDef: unknown = null;
  instanceEntry: { id: string } = { id: "" };
  render() {
    return html`<div class="demo-card">demo ${this.instanceEntry.id}</div>`;
  }
}

// A second served class under the same component key — the class identity a
// stale cleanup must respect when deciding whether it still owns the key.
class NewerDemoCard extends LitElement {
  static properties = {
    workflowDef: { attribute: false },
    instanceEntry: { attribute: false },
  };
  workflowDef: unknown = null;
  instanceEntry: { id: string } = { id: "" };
  render() {
    return html`<div class="newer-demo-card">newer ${this.instanceEntry.id}</div>`;
  }
}

// A stand-in for the served flow-level surface (the flow-component): the
// element the page must keep mounted across a transient registry miss.
class FlowSurface extends LitElement {
  render() {
    return html`<div class="flow-surface">surface</div>`;
  }
}

const evaluate: FlowComponentEvaluator = async () => ({
  default: () => ({ components: { "demo-card": DemoCard } }),
});

let restore: (() => void) | undefined;

beforeEach(() => {
  defineFlowRenderingComponents();
  // jsdom has no fetch; stub a responding one (individual tests override it
  // to exercise failure paths).
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, text: async () => "" }))
  );
});

afterEach(() => {
  restore?.();
  restore = undefined;
  vi.unstubAllGlobals();
});

describe("loadFlowComponents", () => {
  it("registers a served component and unregisters it on cleanup", async () => {
    expect(getComponentRenderer("demo-card")).toBeUndefined();

    restore = await loadFlowComponents(
      { "demo-card": "/api/flows/definitions/demo/components/demo-card" },
      evaluate
    );
    expect(getComponentRenderer("demo-card")).toBe(DemoCard);

    restore();
    restore = undefined;
    expect(getComponentRenderer("demo-card")).toBeUndefined();
  });

  it("renders a served instance component through the board", async () => {
    restore = await loadFlowComponents(
      { "demo-card": "/api/flows/definitions/demo/components/demo-card" },
      evaluate
    );

    const def = cardDef({
      ui: { view: "board", instanceComponent: "demo-card" },
    });
    const el = await mount(
      Object.assign(new WorkflowInstances(), {
        flowId: "flow-1",
        workflowDefs: [def],
        instances: [entry("c1", "ready")],
        customKinds: [],
      })
    );
    await settle(shadowRootOf(el));

    // The custom component mounts inside dynamic-element-host's .mount div;
    // its tag name is class-derived (unregistered), so query structurally.
    const host = mustFind(el, "dynamic-element-host");
    const mounted = shadowRootOf(host).querySelector(".mount > *");
    expect(mounted).not.toBeNull();
    expect(mounted?.shadowRoot?.querySelector(".demo-card")?.textContent).toBe(
      "demo c1"
    );
  });

  it("skips modules whose URL import fails", async () => {
    const failing: FlowComponentEvaluator = async () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    };

    restore = await loadFlowComponents(
      { missing: "/api/.../missing", down: "/api/.../down" },
      failing
    );
    expect(getComponentRenderer("missing")).toBeUndefined();
    expect(getComponentRenderer("down")).toBeUndefined();
  });

  it("re-renders the board when a served component loads after mount", async () => {
    // The ideas-card class of bug: the component load is async, so the board
    // first renders the default card, and the host must re-render once the
    // served component lands (an earlier bug left the default card mounted
    // until a manual requestUpdate).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    let resolveEvaluate: (module: FlowComponentModule) => void = () => {};
    const deferred: FlowComponentEvaluator = () =>
      new Promise((resolve) => {
        resolveEvaluate = resolve;
      });

    const def = cardDef({
      ui: { view: "board", instanceComponent: "demo-card" },
    });
    const el = await mount(
      Object.assign(new WorkflowInstances(), {
        flowId: "flow-1",
        workflowDefs: [def],
        instances: [entry("c1", "ready")],
        customKinds: [],
      })
    );
    await settle(shadowRootOf(el));
    // Before the component loads, the default card is mounted.
    expect(
      mustFind(el, "dynamic-element-host").shadowRoot?.querySelector(
        ".mount > *"
      )?.tagName
    ).toBe("WORKFLOW-INSTANCE-CARD");

    const loadPromise = loadFlowComponents(
      { "demo-card": "/api/.../demo-card" },
      deferred
    );
    // The evaluator runs synchronously inside the loop; settle, then release.
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveEvaluate({
      default: () => ({ components: { "demo-card": DemoCard } }),
    });
    restore = await loadPromise;
    // After the load resolves, the host re-syncs (LitFlowHost's .then calls
    // host.requestUpdate — the fix for the stuck-default-card bug). Once a
    // re-render happens, the served component must replace the default card.
    el.requestUpdate();
    await el.updateComplete;
    await settle(shadowRootOf(el));
    expect(
      mustFind(el, "dynamic-element-host")
        .shadowRoot?.querySelector(".mount > *")
        ?.shadowRoot?.querySelector(".demo-card")?.textContent
    ).toBe("demo c1");
  });

  it("skips a module whose default export is not a factory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const notAFactory: FlowComponentEvaluator = async () => ({
      default: 42 as never,
    });
    restore = await loadFlowComponents(
      { "not-a-factory": "/api/.../not-a-factory" },
      notAFactory
    );
    expect(getComponentRenderer("not-a-factory")).toBeUndefined();
  });

  it("a stale cleanup does not clobber a newer registration of the same key", async () => {
    // The reload race: LitFlowHost's load effect starts a load, a snapshot
    // update (a definition save bumps ?v=) re-runs the effect, and the FIRST
    // load's .then — seeing itself disposed — calls its restore(). If that
    // restore unregisters by key it wipes the SECOND load's registration (the
    // served components silently vanish on reload). The restore must only undo
    // its own element: an identity check before unregistering. A version
    // change is simulated with two different ?v= paths — the same path never
    // re-loads, because the loader cache makes a same-version load a no-op.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const oldEvaluate: FlowComponentEvaluator = async () => ({
      default: () => ({ components: { "demo-card": DemoCard } }),
    });
    const newEvaluate: FlowComponentEvaluator = async () => ({
      default: () => ({
        components: { "demo-card": NewerDemoCard },
      }),
    });

    // The first version registers (and captures prior = undefined), then a
    // second version registers the newer class over it. Invoking the FIRST
    // version's restore afterwards (the disposed-batch cleanup) must leave the
    // newer registration in place.
    const staleRestore = await loadFlowComponents(
      { "demo-card": "/api/.../demo-card?v=1" },
      oldEvaluate
    );
    const currentRestore = await loadFlowComponents(
      { "demo-card": "/api/.../demo-card?v=2" },
      newEvaluate
    );
    expect(getComponentRenderer("demo-card")).toBe(NewerDemoCard);

    staleRestore();
    expect(getComponentRenderer("demo-card")).toBe(NewerDemoCard);

    // The live (second version) load's cleanup restores what preceded it — the
    // first version's element (stack semantics for sequential load/unload).
    currentRestore();
    expect(getComponentRenderer("demo-card")).toBe(DemoCard);

    // The first version's cleanup already released at refcount 0 — re-invoking
    // it is a no-op under the refcounted cache.
    staleRestore();
    expect(getComponentRenderer("demo-card")).toBe(DemoCard);
  });

  it("degrades when the evaluator throws while loading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "boom" }))
    );
    const throwing: FlowComponentEvaluator = async () => {
      throw new Error("evaluation failed");
    };
    restore = await loadFlowComponents(
      { "throwing-card": "/api/.../throwing-card?v=1" },
      throwing
    );
    expect(getComponentRenderer("throwing-card")).toBeUndefined();
  });

  it("re-loading the same version is a no-op: same class, evaluator not re-invoked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const evaluateSpy = vi.fn<FlowComponentEvaluator>(async () => ({
      default: () => ({ components: { "identity-card": DemoCard } }),
    }));
    const firstRestore = await loadFlowComponents(
      { "identity-card": "/api/.../identity-card?v=1" },
      evaluateSpy
    );
    expect(getComponentRenderer("identity-card")).toBe(DemoCard);
    expect(evaluateSpy).toHaveBeenCalledTimes(1);

    // A second load of the same version returns the cached class without
    // re-evaluating — the registry identity never changes, so the mounted
    // element survives snapshot churn.
    const secondRestore = await loadFlowComponents(
      { "identity-card": "/api/.../identity-card?v=1" },
      evaluateSpy
    );
    expect(getComponentRenderer("identity-card")).toBe(DemoCard);
    expect(evaluateSpy).toHaveBeenCalledTimes(1);

    // Refcounted unload: only the last release unregisters.
    secondRestore();
    expect(getComponentRenderer("identity-card")).toBe(DemoCard);
    firstRestore();
    expect(getComponentRenderer("identity-card")).toBeUndefined();
  });

  it("a version change registers a new class identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const v1Restore = await loadFlowComponents(
      { "version-card": "/api/.../version-card?v=1" },
      async () => ({
        default: () => ({ components: { "version-card": DemoCard } }),
      })
    );
    expect(getComponentRenderer("version-card")).toBe(DemoCard);

    const v2Restore = await loadFlowComponents(
      { "version-card": "/api/.../version-card?v=2" },
      async () => ({
        default: () => ({ components: { "version-card": NewerDemoCard } }),
      })
    );
    expect(getComponentRenderer("version-card")).toBe(NewerDemoCard);

    // Stack semantics: the newer version's cleanup restores the older class,
    // whose own cleanup then unregisters it.
    v2Restore();
    expect(getComponentRenderer("version-card")).toBe(DemoCard);
    v1Restore();
    expect(getComponentRenderer("version-card")).toBeUndefined();
  });

  it("a transient registry miss keeps the mounted flow surface (no default flash)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restoreSurface = await loadFlowComponents(
      { "flow-component": "/api/.../flow-component?v=1" },
      async () => ({
        default: () => ({ components: { "flow-component": FlowSurface } }),
      })
    );

    const def = cardDef({});
    const el = await mount(
      Object.assign(new WorkflowInstances(), {
        flowId: "flow-1",
        flowComponent: "flow-component",
        workflowDefs: [def],
        instances: [entry("c1", "ready")],
        customKinds: [],
      })
    );
    await settle(shadowRootOf(el));
    const host = mustFind(el, "dynamic-element-host");
    const mounted = shadowRootOf(host).querySelector(".mount > *");
    expect(mounted).not.toBeNull();
    expect(mounted?.shadowRoot?.querySelector(".flow-surface")).not.toBeNull();

    // The registry transiently misses the class (async re-load in progress,
    // the cleanup window between unregister and re-register): the custom
    // surface must stay mounted — the same element instance — and the default
    // per-workflow boards must never flash.
    restoreSurface();
    el.requestUpdate();
    await el.updateComplete;
    await settle(shadowRootOf(el));

    const mountedAfter = shadowRootOf(
      mustFind(el, "dynamic-element-host")
    ).querySelector(".mount > *");
    expect(mountedAfter).toBe(mounted);
    expect(el.shadowRoot?.querySelector(".flow")).toBeNull();
  });

  it("hands served modules the svg runtime for SVG templates", async () => {
    let received: FlowComponentDeps | undefined;
    restore = await loadFlowComponents(
      { probe: "/api/.../probe" },
      async () => ({
        default: (deps: FlowComponentDeps) => {
          received = deps;
          return {};
        },
      })
    );
    expect(received).toBeDefined();
    expect(typeof received?.svg).toBe("function");
  });
});
