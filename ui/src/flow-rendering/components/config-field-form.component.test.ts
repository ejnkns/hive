import { describe, expect, it } from "vitest";
import type { ConfigField } from "workflow-engine/workflow-types";
import {
  click,
  mount,
  queryAllDeep,
  queryDeep,
  settle,
  shadowRootOf,
} from "../test-utils";
import { ConfigFieldForm } from "./config-field-form";

function field(overrides: Partial<ConfigField> & { key: string }): ConfigField {
  return { label: overrides.key, type: "string", ...overrides };
}

async function mountForm(
  form: Partial<ConfigFieldForm>
): Promise<ConfigFieldForm> {
  const el = await mount(Object.assign(new ConfigFieldForm(), form));
  await settle(shadowRootOf(el));
  return el;
}

function input(el: ConfigFieldForm, selector: string): HTMLInputElement {
  const found = queryDeep(el, selector) as HTMLInputElement;
  expect(found, selector).toBeDefined();
  return found;
}

function submitButton(el: ConfigFieldForm): HTMLButtonElement {
  const found = queryAllDeep(el, "button").find(
    (b) => b.textContent?.trim() === "Submit"
  ) as HTMLButtonElement | undefined;
  expect(found).toBeDefined();
  return found as HTMLButtonElement;
}

describe("ConfigFieldForm", () => {
  it("renders one control per field type", async () => {
    const fields: ConfigField[] = [
      field({ key: "title", type: "string" }),
      field({ key: "note", type: "textarea" }),
      field({ key: "due", type: "date" }),
      field({ key: "deadline", type: "datetime" }),
      field({ key: "count", type: "number" }),
      field({ key: "approved", type: "boolean" }),
      field({ key: "kind", type: "string", options: ["a", "b"] }),
      field({ key: "tags", type: "string[]", options: ["x", "y"] }),
    ];
    const el = await mountForm({ fields });
    expect(input(el, 'input[type="date"]')).toBeDefined();
    expect(input(el, 'input[type="datetime-local"]')).toBeDefined();
    expect(input(el, 'input[type="number"]')).toBeDefined();
    expect(input(el, 'input[type="checkbox"]')).toBeDefined();
    expect(queryDeep(el, "textarea")).toBeDefined();
    expect(queryDeep(el, "select")).toBeDefined();
    // Multi-select renders one checkbox per option.
    expect(queryAllDeep(el, ".chip input[type=checkbox]")).toHaveLength(2);
  });

  it("pre-fills from values then defaultValue", async () => {
    const fields: ConfigField[] = [
      field({ key: "title", type: "string", defaultValue: "Default title" }),
      field({ key: "note", type: "textarea" }),
    ];
    const el = await mountForm({ fields, values: { note: "Existing note" } });
    expect(input(el, 'input[type="text"]').value).toBe("Default title");
    expect((queryDeep(el, "textarea") as HTMLTextAreaElement).value).toBe(
      "Existing note"
    );
  });

  it("gates submission on required fields", async () => {
    const fields: ConfigField[] = [
      field({ key: "note", type: "textarea", required: true }),
    ];
    const el = await mountForm({ fields });
    expect(submitButton(el).disabled).toBe(true);
    const textarea = queryDeep(el, "textarea") as HTMLTextAreaElement;
    textarea.value = "a note";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    expect(submitButton(el).disabled).toBe(false);
  });

  it("emits hive-fields-submit with collected values, stripping empty optionals", async () => {
    const fields: ConfigField[] = [
      field({ key: "title", type: "string", required: true }),
      field({ key: "note", type: "textarea" }),
    ];
    const el = await mountForm({ fields, values: { title: "T", note: "" } });
    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-fields-submit", resolve as EventListener, {
        once: true,
      })
    );
    submitButton(el).dispatchEvent(click());
    const detail = (await emitted).detail as {
      values: Record<string, unknown>;
    };
    expect(detail.values).toEqual({ title: "T" });
  });

  it("emits hive-fields-cancel on cancel", async () => {
    const el = await mountForm({ fields: [field({ key: "title" })] });
    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-fields-cancel", resolve as EventListener, {
        once: true,
      })
    );
    const cancel = queryAllDeep(el, "button").find(
      (b) => b.textContent?.trim() === "Cancel"
    );
    expect(cancel).toBeDefined();
    cancel?.dispatchEvent(click());
    await emitted;
  });

  it("collects multi-select values from option checkboxes", async () => {
    const fields: ConfigField[] = [
      field({ key: "tags", type: "string[]", options: ["x", "y", "z"] }),
    ];
    const el = await mountForm({ fields, values: { tags: ["x"] } });
    const checkboxes = queryAllDeep(
      el,
      ".chip input[type=checkbox]"
    ) as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
    checkboxes[1].dispatchEvent(click());
    await el.updateComplete;

    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-fields-submit", resolve as EventListener, {
        once: true,
      })
    );
    submitButton(el).dispatchEvent(click());
    const detail = (await emitted).detail as {
      values: Record<string, unknown>;
    };
    expect(detail.values.tags).toEqual(["x", "y"]);
  });

  it("parses free-tag string[] from comma-separated input", async () => {
    const fields: ConfigField[] = [field({ key: "tags", type: "string[]" })];
    const el = await mountForm({ fields });
    const text = input(el, 'input[type="text"]');
    text.value = " alpha,beta ,";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;

    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-fields-submit", resolve as EventListener, {
        once: true,
      })
    );
    submitButton(el).dispatchEvent(click());
    const detail = (await emitted).detail as {
      values: Record<string, unknown>;
    };
    expect(detail.values.tags).toEqual(["alpha", "beta"]);
  });
});
