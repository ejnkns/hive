import { html, LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowInstances } from "./components/workflow-instances";
import { defineFlowRenderingComponents } from "./define-components";
import {
  type FlowComponentEvaluator,
  loadFlowComponents,
} from "./load-flow-components";
import { getComponentRenderer } from "./renderer-registry";
import { cardDef, entry } from "./test-fixtures";
import { mount, mustFind, settle, shadowRootOf } from "./test-utils";

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
customElements.define("demo-card-element", DemoCard);

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

  it("skips modules that 404, export no factory, or fail to fetch", async () => {
    const fetchMock = vi.fn(async (path: string) => {
      if (path.includes("missing")) return { ok: false, text: async () => "" };
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    restore = await loadFlowComponents(
      {
        missing: "/api/.../missing",
        down: "/api/.../down",
      },
      evaluate
    );
    expect(getComponentRenderer("missing")).toBeUndefined();
    expect(getComponentRenderer("down")).toBeUndefined();
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

  it("degrades when the evaluator throws while loading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "boom" }))
    );
    const throwing: FlowComponentEvaluator = async () => {
      throw new Error("evaluation failed");
    };
    restore = await loadFlowComponents(
      { "demo-card": "/api/.../demo-card" },
      throwing
    );
    expect(getComponentRenderer("demo-card")).toBeUndefined();
  });
});
