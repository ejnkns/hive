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

  it("confirms after collecting fields for a destructive fielded action, emitting the payload", async () => {
    const fielded = {
      ...action("reject", "Reject", "destructive"),
      fields: [
        {
          key: "reason",
          label: "Reason",
          type: "textarea" as const,
          required: true,
        },
      ],
    };
    const el = await mount(
      Object.assign(new ActionBar(), { actions: [fielded] })
    );
    await settle(shadowRootOf(el));

    // Click → the form opens; no confirm step yet.
    buttons(el)[0].dispatchEvent(click());
    await el.updateComplete;
    const form = shadowRootOf(el).querySelector("config-field-form");
    expect(form).not.toBeNull();
    expect(shadowRootOf(el).querySelector(".confirm-row")).toBeNull();

    // Fill the reason and submit → the confirm step appears, nothing emitted.
    let emitted = false;
    el.addEventListener("hive-action", () => (emitted = true));
    const formRoot = (form as HTMLElement).shadowRoot as ShadowRoot;
    const textarea = formRoot.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "Out of scope";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const submit = queryAllDeep(form as unknown as ActionBar, "button").find(
      (b) => b.textContent?.trim() === "Submit"
    );
    expect(submit).toBeDefined();
    submit?.dispatchEvent(click());
    await el.updateComplete;
    await settle(shadowRootOf(el));

    expect(emitted).toBe(false);
    expect(shadowRootOf(el).querySelector(".confirm-row")).not.toBeNull();
    expect(shadowRootOf(el).querySelector("config-field-form")).toBeNull();

    // Confirm → emits with the collected payload.
    const emittedEvent = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-action", resolve as EventListener, {
        once: true,
      })
    );
    const confirmBtn = buttons(el).find(
      (b) => b.textContent?.trim() === "Confirm"
    );
    expect(confirmBtn).toBeDefined();
    confirmBtn?.dispatchEvent(click());
    expect((await emittedEvent).detail).toEqual({
      actionId: "reject",
      payload: { reason: "Out of scope" },
    });
  });

  it("cancelling the confirm after a form discards the payload", async () => {
    const fielded = {
      ...action("reject", "Reject", "destructive"),
      fields: [
        {
          key: "reason",
          label: "Reason",
          type: "textarea" as const,
          required: true,
        },
      ],
    };
    const el = await mount(
      Object.assign(new ActionBar(), { actions: [fielded] })
    );
    await settle(shadowRootOf(el));

    let emitted = false;
    el.addEventListener("hive-action", () => (emitted = true));

    buttons(el)[0].dispatchEvent(click());
    await el.updateComplete;
    const form = shadowRootOf(el).querySelector("config-field-form");
    const formRoot = (form as HTMLElement).shadowRoot as ShadowRoot;
    const textarea = formRoot.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "Reason here";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const submit = queryAllDeep(form as unknown as ActionBar, "button").find(
      (b) => b.textContent?.trim() === "Submit"
    );
    submit?.dispatchEvent(click());
    await el.updateComplete;
    await settle(shadowRootOf(el));

    const cancel = buttons(el).find((b) => b.textContent?.trim() === "Cancel");
    expect(cancel).toBeDefined();
    cancel?.dispatchEvent(click());
    await el.updateComplete;

    expect(emitted).toBe(false);
    expect(shadowRootOf(el).querySelector(".confirm-row")).toBeNull();
    // The action row is back; re-clicking opens a fresh form, not a stale
    // confirm with a leftover payload.
    buttons(el)[0].dispatchEvent(click());
    await el.updateComplete;
    expect(shadowRootOf(el).querySelector("config-field-form")).not.toBeNull();
  });

  it("uses custom confirmText wording and confirms non-destructive actions that declare it", async () => {
    const confirmable = {
      ...action("wipe", "Wipe"),
      confirmText: "Erase all data?",
    };
    const el = await mount(
      Object.assign(new ActionBar(), { actions: [confirmable] })
    );
    await settle(shadowRootOf(el));

    let emitted = false;
    el.addEventListener("hive-action", () => (emitted = true));
    buttons(el)[0].dispatchEvent(click());
    await el.updateComplete;

    expect(emitted).toBe(false);
    const text = shadowRootOf(el).querySelector(".confirm-text");
    expect(text?.textContent).toBe("Erase all data?");
  });
});
