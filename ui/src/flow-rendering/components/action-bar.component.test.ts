import { describe, expect, it } from "vitest";
import { action } from "../test-fixtures";
import {
  click,
  mount,
  mustQuery,
  queryAllDeep,
  settle,
  shadowRootOf,
} from "../test-utils";
import { ActionBar } from "./action-bar";

function buttons(el: ActionBar): HTMLButtonElement[] {
  return queryAllDeep(el, "button") as HTMLButtonElement[];
}

describe("ActionBar", () => {
  it("emits hive-action immediately for non-destructive actions", async () => {
    const el = await mount(
      Object.assign(new ActionBar(), {
        actions: [action("run", "Run"), action("skip", "Skip", "secondary")],
      })
    );
    await settle(shadowRootOf(el));

    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-action", resolve as EventListener, {
        once: true,
      })
    );
    const run = buttons(el).find((b) => b.textContent?.trim() === "Run");
    expect(run).toBeDefined();
    run?.dispatchEvent(click());
    expect((await emitted).detail).toEqual({ actionId: "run" });
  });

  it("requires a confirm step before destructive actions emit", async () => {
    const el = await mount(
      Object.assign(new ActionBar(), {
        actions: [action("archive", "Archive", "destructive")],
      })
    );
    await settle(shadowRootOf(el));

    let emitted = false;
    el.addEventListener("hive-action", () => (emitted = true));

    const archive = buttons(el)[0];
    expect(archive).toBeDefined();
    archive?.dispatchEvent(click());
    await el.updateComplete;
    expect(emitted).toBe(false);
    expect(mustQuery(shadowRootOf(el), ".confirm-row")).toBeDefined();

    const confirm = buttons(el).find(
      (b) => b.textContent?.trim() === "Confirm"
    );
    expect(confirm).toBeDefined();
    confirm?.dispatchEvent(click());
    await el.updateComplete;
    expect(emitted).toBe(true);
  });

  it("dismisses the confirm step without emitting", async () => {
    const el = await mount(
      Object.assign(new ActionBar(), {
        actions: [action("archive", "Archive", "destructive")],
      })
    );
    await settle(shadowRootOf(el));

    let emitted = false;
    el.addEventListener("hive-action", () => (emitted = true));

    const archive = buttons(el)[0];
    expect(archive).toBeDefined();
    archive?.dispatchEvent(click());
    await el.updateComplete;

    const cancel = buttons(el).find((b) => b.textContent?.trim() === "Cancel");
    expect(cancel).toBeDefined();
    cancel?.dispatchEvent(click());
    await el.updateComplete;
    expect(emitted).toBe(false);
    expect(shadowRootOf(el).querySelector(".confirm-row")).toBeNull();
  });

  it("opens the field form for a fielded action and emits the collected payload", async () => {
    const fielded = {
      ...action("correct", "Correct"),
      fields: [
        {
          key: "note",
          label: "Note",
          type: "textarea" as const,
          required: true,
        },
      ],
    };
    const el = await mount(
      Object.assign(new ActionBar(), { actions: [fielded] })
    );
    await settle(shadowRootOf(el));

    const correct = buttons(el)[0];
    correct?.dispatchEvent(click());
    await el.updateComplete;

    const form = shadowRootOf(el).querySelector("config-field-form");
    expect(form).not.toBeNull();

    // The form's submit is gated until the required textarea is filled.
    const formRoot = (form as HTMLElement).shadowRoot as ShadowRoot;
    const textarea = formRoot.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "Fix the totals";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-action", resolve as EventListener, {
        once: true,
      })
    );
    const submit = queryAllDeep(form as unknown as ActionBar, "button").find(
      (b) => b.textContent?.trim() === "Submit"
    );
    expect(submit).toBeDefined();
    submit?.dispatchEvent(click());
    expect((await emitted).detail).toEqual({
      actionId: "correct",
      payload: { note: "Fix the totals" },
    });
  });
});
