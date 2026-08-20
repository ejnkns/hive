import { describe, expect, it } from "vitest";
import { mount, settle, shadowRootOf } from "../test-utils.ts";
import { ChipsView } from "./chips-view.ts";

// Element tests for the builtin chips render kind: pill rendering, defensive
// stringification, and the total behavior on a non-array / empty `items`
// (contract resolution falls back to json before this point, but the element
// itself must not crash on a malformed bound value).

describe("ChipsView", () => {
  it("renders each string item as an inline pill", async () => {
    const el = await mount(
      Object.assign(new ChipsView(), { items: ["a11y", "offline"] })
    );
    await settle(shadowRootOf(el));
    const pills = [...shadowRootOf(el).querySelectorAll(".chip")];
    expect(pills.map((p) => p.textContent)).toEqual(["a11y", "offline"]);
  });

  it("stringifies non-string items defensively", async () => {
    const el = await mount(
      Object.assign(new ChipsView(), { items: ["x", 42, true] })
    );
    await settle(shadowRootOf(el));
    const pills = [...shadowRootOf(el).querySelectorAll(".chip")];
    expect(pills.map((p) => p.textContent)).toEqual(["x", "42", "true"]);
  });

  it("renders nothing for a non-array items value", async () => {
    const el = await mount(
      Object.assign(new ChipsView(), { items: "not-an-array" })
    );
    await settle(shadowRootOf(el));
    expect(shadowRootOf(el).querySelector(".chips")).toBeNull();
  });

  it("renders nothing for an empty items array", async () => {
    const el = await mount(new ChipsView());
    await settle(shadowRootOf(el));
    expect(shadowRootOf(el).querySelector(".chips")).toBeNull();
  });
});
