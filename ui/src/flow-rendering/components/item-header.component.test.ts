import { describe, expect, it } from "vitest";
import { mount, mustQuery, settle, shadowRootOf } from "../test-utils";
import { ItemHeader } from "./item-header";

function header(overrides: Partial<InstanceType<typeof ItemHeader>> = {}) {
  return Object.assign(new ItemHeader(), overrides);
}

describe("ItemHeader", () => {
  it("renders title, subtitle, and description", async () => {
    const el = await mount(
      header({
        title: "Ship the API",
        subtitle: "card-1",
        description: "Do the thing",
      })
    );
    await settle(shadowRootOf(el));
    expect(mustQuery(shadowRootOf(el), ".title").textContent).toBe(
      "Ship the API"
    );
    expect(mustQuery(shadowRootOf(el), ".subtitle").textContent).toBe("card-1");
    expect(mustQuery(shadowRootOf(el), ".description").textContent).toBe(
      "Do the thing"
    );
  });

  it("badges terminal state as Done", async () => {
    const el = await mount(header({ title: "x", category: "terminal" }));
    await settle(shadowRootOf(el));
    expect(mustQuery(shadowRootOf(el), ".badge").textContent).toBe("Done");
  });

  it("badges error state as Blocked and initial as Ready", async () => {
    const error = await mount(header({ title: "x", category: "error" }));
    await settle(shadowRootOf(error));
    expect(mustQuery(shadowRootOf(error), ".badge").textContent).toBe(
      "Blocked"
    );

    const initial = await mount(header({ title: "x", category: "initial" }));
    await settle(shadowRootOf(initial));
    expect(mustQuery(shadowRootOf(initial), ".badge").textContent).toBe(
      "Ready"
    );
  });

  it("shows a running badge while a task is running", async () => {
    const el = await mount(
      header({ title: "x", category: "active", hasRunningTask: true })
    );
    await settle(shadowRootOf(el));
    const running = [...shadowRootOf(el).querySelectorAll(".badge")].find((b) =>
      b.textContent?.includes("Running")
    );
    expect(running).toBeDefined();
    expect(running?.classList.contains("badge-live")).toBe(true);
  });
});
