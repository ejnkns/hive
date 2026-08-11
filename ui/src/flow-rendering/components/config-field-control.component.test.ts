import { describe, expect, it } from "vitest";
import type { ConfigField } from "workflow-engine/workflow-types";
import { click, mount, type } from "../test-utils.ts";
import { ConfigFieldControl } from "./config-field-control.ts";

// Behavior tests for the single-field control: one control per ConfigField
// type, the id/name semantics, the change-event contract (hive-field-change
// with { key, value }), textarea cleanliness, and value pre-fill. The control
// renders in light DOM (createRenderRoot returns the element), so its inputs
// are reachable from the parent form's shadow tree.

function field(overrides: Partial<ConfigField> & { key: string }): ConfigField {
  return { label: overrides.key, type: "string", ...overrides };
}

async function mountControl(
  control: Partial<ConfigFieldControl>
): Promise<ConfigFieldControl> {
  const el = await mount(Object.assign(new ConfigFieldControl(), control));
  await el.updateComplete;
  return el;
}

// The control's inputs render as its own light-DOM children.
function controlInput(
  el: ConfigFieldControl,
  selector: string
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const found = el.querySelector(selector);
  expect(found, selector).toBeDefined();
  return found as HTMLInputElement;
}

function emittedChange(el: ConfigFieldControl) {
  return new Promise<CustomEvent>((resolve) =>
    el.addEventListener("hive-field-change", resolve as EventListener, {
      once: true,
    })
  );
}

describe("ConfigFieldControl", () => {
  it("renders one control per field type with id and name", async () => {
    const el = await mountControl({
      field: field({ key: "title", type: "string" }),
    });
    const text = controlInput(el, 'input[type="text"]');
    expect(text.id).toBe("cf-title");
    expect(text.name).toBe("title");
  });

  it("renders every field type with its control and the cf-<key> id", async () => {
    const types: ConfigField[] = [
      field({ key: "title", type: "string" }),
      field({ key: "note", type: "textarea" }),
      field({ key: "due", type: "date" }),
      field({ key: "deadline", type: "datetime" }),
      field({ key: "count", type: "number" }),
      field({ key: "approved", type: "boolean" }),
      field({ key: "kind", type: "string", options: ["a", "b"] }),
      field({ key: "tags", type: "string[]", options: ["x", "y"] }),
    ];
    for (const f of types) {
      const el = await mountControl({ field: f });
      const controls = [
        ...el.querySelectorAll<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >('input, textarea, select, .chip input[type="checkbox"]'),
      ];
      expect(controls.length, f.key).toBeGreaterThan(0);
      for (const control of controls) {
        if (control.classList.contains("chip")) continue;
        expect(control.id).toContain("cf-");
        expect(control.name).toBe(f.key);
      }
    }
  });

  it("gives every multiselect chip checkbox an id and name", async () => {
    const el = await mountControl({
      field: field({ key: "tags", type: "string[]", options: ["x", "y"] }),
    });
    const checkboxes = [
      ...el.querySelectorAll<HTMLInputElement>(".chip input[type=checkbox]"),
    ];
    expect(checkboxes.map((c) => c.id)).toEqual(["cf-tags-0", "cf-tags-1"]);
    expect(checkboxes.every((c) => c.name === "tags")).toBe(true);
  });

  it("renders a textarea with a clean empty value (no template whitespace)", async () => {
    const el = await mountControl({
      field: field({ key: "note", type: "textarea" }),
    });
    const textarea = el.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("pre-fills from the value prop", async () => {
    const el = await mountControl({
      field: field({ key: "title", type: "string" }),
      value: "Existing title",
    });
    expect(controlInput(el, 'input[type="text"]').value).toBe("Existing title");
  });

  it("emits hive-field-change with { key, value } on text input", async () => {
    const el = await mountControl({
      field: field({ key: "title", type: "string" }),
    });
    const emitted = emittedChange(el);
    type(controlInput(el, 'input[type="text"]') as HTMLInputElement, "Hello");
    expect((await emitted).detail).toEqual({ key: "title", value: "Hello" });
  });

  it("emits a number value for number fields and undefined when cleared", async () => {
    const el = await mountControl({
      field: field({ key: "count", type: "number" }),
    });
    const input = controlInput(el, 'input[type="number"]') as HTMLInputElement;

    const filled = emittedChange(el);
    type(input, "42");
    expect((await filled).detail).toEqual({ key: "count", value: 42 });

    const cleared = emittedChange(el);
    type(input, "");
    expect((await cleared).detail).toEqual({ key: "count", value: undefined });
  });

  it("emits the checked boolean for checkboxes", async () => {
    const el = await mountControl({
      field: field({ key: "approved", type: "boolean" }),
    });
    const checkbox = el.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    const emitted = emittedChange(el);
    checkbox.dispatchEvent(click());
    expect((await emitted).detail).toEqual({ key: "approved", value: true });
  });

  it("emits the selected option for string fields with options", async () => {
    const el = await mountControl({
      field: field({ key: "kind", type: "string", options: ["a", "b"] }),
    });
    const select = el.querySelector("select") as HTMLSelectElement;
    const emitted = emittedChange(el);
    select.value = "b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect((await emitted).detail).toEqual({ key: "kind", value: "b" });
  });

  it("emits the toggled array for multiselect chips", async () => {
    const el = await mountControl({
      field: field({ key: "tags", type: "string[]", options: ["x", "y"] }),
      value: ["x"],
    });
    const checkboxes = [
      ...el.querySelectorAll<HTMLInputElement>(".chip input[type=checkbox]"),
    ];
    expect(checkboxes[0]?.checked).toBe(true);
    expect(checkboxes[1]?.checked).toBe(false);

    const emitted = emittedChange(el);
    checkboxes[1]?.dispatchEvent(click());
    expect((await emitted).detail).toEqual({ key: "tags", value: ["x", "y"] });
  });

  it("parses free-tag string[] from comma-separated input", async () => {
    const el = await mountControl({
      field: field({ key: "tags", type: "string[]" }),
    });
    const emitted = emittedChange(el);
    type(
      el.querySelector('input[type="text"]') as HTMLInputElement,
      " alpha,beta ,"
    );
    expect((await emitted).detail).toEqual({
      key: "tags",
      value: ["alpha", "beta"],
    });
  });

  it("threads the disabled flag to every control", async () => {
    const el = await mountControl({
      field: field({ key: "title", type: "string" }),
      disabled: true,
    });
    expect(
      (controlInput(el, 'input[type="text"]') as HTMLInputElement).disabled
    ).toBe(true);
  });

  it("emits the textarea value on input", async () => {
    const el = await mountControl({
      field: field({ key: "note", type: "textarea" }),
    });
    const textarea = el.querySelector("textarea") as HTMLTextAreaElement;
    const emitted = emittedChange(el);
    textarea.value = "A note";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect((await emitted).detail).toEqual({ key: "note", value: "A note" });
    // The value stays bound to the property, never element content.
    expect(el.innerHTML).not.toContain(">A note<");
    expect(el.querySelector("textarea")?.innerHTML).not.toContain("A note");
  });
});
