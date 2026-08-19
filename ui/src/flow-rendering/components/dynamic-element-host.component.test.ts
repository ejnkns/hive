import { html, LitElement } from "lit";
import { describe, expect, it } from "vitest";
import { mount, mustQuery, settle, shadowRootOf } from "../test-utils.ts";
import type { ElementConstructor } from "./dynamic-element-host.ts";
import { DynamicElementHost } from "./dynamic-element-host.ts";

class Probe extends LitElement {
  static properties = { label: { type: String }, count: { type: Number } };
  label = "";
  count = 0;
  render() {
    return html`<div class="probe">${this.label} x${this.count}</div>`;
  }
}
customElements.define("probe-element", Probe);

class Other extends LitElement {
  render() {
    return html`<div class="other">other</div>`;
  }
}
customElements.define("other-element", Other);

function host(props: {
  elementClass: ElementConstructor;
  props: Record<string, unknown>;
}): DynamicElementHost {
  return Object.assign(new DynamicElementHost(), props);
}

function probeOf(el: DynamicElementHost): Probe {
  return mustQuery(shadowRootOf(el), "probe-element") as Probe;
}

describe("DynamicElementHost", () => {
  it("mounts the element class and forwards props", async () => {
    const el: DynamicElementHost = await mount(
      host({ elementClass: Probe, props: { label: "hi", count: 3 } })
    );
    await settle(shadowRootOf(el));
    const probe = probeOf(el);
    expect(probe.label).toBe("hi");
    expect(probe.count).toBe(3);
    expect(probe.shadowRoot?.querySelector(".probe")?.textContent).toBe(
      "hi x3"
    );
  });

  it("swaps the mounted element when the class changes", async () => {
    const el: DynamicElementHost = await mount(
      host({ elementClass: Probe, props: { label: "a" } })
    );
    await settle(shadowRootOf(el));
    expect(shadowRootOf(el).querySelector("probe-element")).not.toBeNull();

    el.elementClass = Other;
    await el.updateComplete;
    await settle(shadowRootOf(el));
    expect(shadowRootOf(el).querySelector("probe-element")).toBeNull();
    expect(shadowRootOf(el).querySelector("other-element")).not.toBeNull();
  });

  it("updates props on the same mounted element", async () => {
    const el: DynamicElementHost = await mount(
      host({ elementClass: Probe, props: { label: "a" } })
    );
    await settle(shadowRootOf(el));
    expect(probeOf(el).label).toBe("a");

    el.props = { label: "b" };
    await el.updateComplete;
    await settle(shadowRootOf(el));
    expect(probeOf(el).label).toBe("b");
  });

  it("keeps the mounted element across a transient elementClass miss", async () => {
    const el: DynamicElementHost = await mount(
      host({ elementClass: Probe, props: { label: "a" } })
    );
    await settle(shadowRootOf(el));
    const mounted = shadowRootOf(el).querySelector("probe-element");
    expect(mounted).not.toBeNull();

    // A transient miss (async load in flight, the cleanup window between
    // unregister and re-register) must not destroy the mounted element.
    el.elementClass = null;
    await el.updateComplete;
    await settle(shadowRootOf(el));
    expect(shadowRootOf(el).querySelector("probe-element")).toBe(mounted);

    // The same class returning is not a swap: still the same instance.
    el.elementClass = Probe;
    await el.updateComplete;
    await settle(shadowRootOf(el));
    expect(shadowRootOf(el).querySelector("probe-element")).toBe(mounted);
    expect(probeOf(el).label).toBe("a");
  });
});
