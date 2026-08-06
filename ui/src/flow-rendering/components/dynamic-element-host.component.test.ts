import { html, LitElement } from "lit";
import { describe, expect, it } from "vitest";
import { mount, mustQuery, settle, shadowRootOf } from "../test-utils";
import type { ElementConstructor } from "./dynamic-element-host";
import { DynamicElementHost } from "./dynamic-element-host";

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
});
