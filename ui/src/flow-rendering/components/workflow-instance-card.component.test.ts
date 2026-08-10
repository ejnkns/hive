import { beforeAll, describe, expect, it } from "vitest";
import { defineFlowRenderingComponents } from "../define-components";
import { action, cardDef, entry } from "../test-fixtures";
import {
  click,
  mount,
  mustFind,
  mustQuery,
  queryAllDeep,
  settle,
  shadowRootOf,
} from "../test-utils";
import { WorkflowInstanceCard } from "./workflow-instance-card";

// Behavior tests for the default instance card: hint-driven title, display
// fields, markdown task outputs, action ordering, and the onAction callback.

beforeAll(() => {
  defineFlowRenderingComponents();
});

function card(def = cardDef(), instance = entry("c1", "ready")) {
  return Object.assign(new WorkflowInstanceCard(), {
    workflowDef: def,
    instanceEntry: instance,
    customKinds: [],
  });
}

describe("WorkflowInstanceCard", () => {
  it("renders the instance-hint title from workflowInstanceState", async () => {
    const el = await mount(card());
    await settle(shadowRootOf(el));
    expect(mustFind(el, ".title").textContent).toBe("Card c1");
  });

  it("renders display fields with labels and values", async () => {
    const def = cardDef({
      display: { fields: [{ path: "cardSpec.title", label: "Title" }] },
    });
    const el = await mount(card(def));
    await settle(shadowRootOf(el));
    const keys = [...shadowRootOf(el).querySelectorAll(".domain-data-key")];
    expect(keys.map((k) => k.textContent)).toEqual(["Title"]);
    const values = [...shadowRootOf(el).querySelectorAll(".domain-data-value")];
    expect(values[0]?.textContent).toBe("Card c1");
  });

  it("renders empty values for display fields missing from instance state", async () => {
    // A generated flow may declare display fields (category, tags) that the
    // instance state never populated — the card must render them empty
    // instead of crashing the whole card render.
    const def = cardDef({
      instance: { title: "idea" },
      display: {
        fields: [
          { path: "idea", label: "Idea" },
          { path: "category", label: "Category" },
          { path: "tags", label: "Tags" },
        ],
      },
    });
    const instance = entry("c1", "ready", {
      workflowInstanceState: { idea: "improve default UI components" },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    const keys = [...shadowRootOf(el).querySelectorAll(".domain-data-key")];
    expect(keys.map((k) => k.textContent)).toEqual([
      "Idea",
      "Category",
      "Tags",
    ]);
    const values = [...shadowRootOf(el).querySelectorAll(".domain-data-value")];
    expect(values.map((v) => v.textContent)).toEqual([
      "improve default UI components",
      "",
      "",
    ]);
    expect(mustFind(el, ".title").textContent).toBe(
      "improve default UI components"
    );
  });

  it("renders a successful task output through its markdown render hint", async () => {
    const def = cardDef({
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [],
          tasks: [{ id: "plan", label: "Plan", render: { kind: "markdown" } }],
        },
      ],
    });
    const instance = entry("c1", "ready", {
      taskOutputs: {
        plan: { status: "success", output: "# Heading" },
      },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    const markdown = mustFind(el, "markdown-view");
    expect(mustQuery(shadowRootOf(markdown), ".markdown h1").textContent).toBe(
      "Heading"
    );
  });

  it("orders available actions primary-first", async () => {
    const instance = entry("c1", "ready");
    instance.availableActions = [
      action("archive", "Archive", "destructive"),
      action("run", "Run", "primary"),
      action("skip", "Skip", "secondary"),
    ];
    const el = await mount(card(undefined, instance));
    await settle(shadowRootOf(el));
    const buttons = queryAllDeep(el, "button");
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      "Run",
      "Skip",
      "Archive",
    ]);
  });

  it("invokes the onAction callback when an action is clicked", async () => {
    const instance = entry("c1", "ready");
    instance.availableActions = [action("run", "Run")];
    const el = await mount(card(undefined, instance));
    el.onAction = (actionId: string) => {
      el.setAttribute("data-on-action", actionId);
    };
    await settle(shadowRootOf(el));

    const button = mustQuery(
      shadowRootOf(mustFind(el, "action-bar")),
      "button"
    ) as HTMLButtonElement;
    button.dispatchEvent(click());
    await el.updateComplete;
    expect(el.getAttribute("data-on-action")).toBe("run");
  });

  it("hides the edit button when the workflow declares no editFields", async () => {
    const el = await mount(card());
    await settle(shadowRootOf(el));
    expect(shadowRootOf(el).querySelector(".edit-btn")).toBeNull();
  });

  it("opens a pre-filled edit form and submits collected values via onPatchState", async () => {
    const instance = entry("c1", "ready", {
      workflowInstanceState: {
        title: "Current title",
        due: "2024-08-10",
      },
    });
    instance.editFields = [
      { key: "title", label: "Title", type: "string", required: true },
      { key: "due", label: "Due", type: "date" },
    ];
    const el = await mount(card(undefined, instance));
    el.onPatchState = (values: Record<string, unknown>) => {
      el.setAttribute("data-patch", JSON.stringify(values));
    };
    await settle(shadowRootOf(el));

    const editButton = mustQuery(
      shadowRootOf(el),
      "button.edit-btn"
    ) as HTMLButtonElement;
    editButton.dispatchEvent(click());
    await settle(shadowRootOf(el));

    const form = shadowRootOf(el).querySelector("config-field-form");
    expect(form).not.toBeNull();
    const formRoot = (form as HTMLElement).shadowRoot as ShadowRoot;
    // The form is pre-filled from instance state.
    const text = formRoot.querySelector(
      'input[type="text"]'
    ) as HTMLInputElement;
    expect(text.value).toBe("Current title");
    const date = formRoot.querySelector(
      'input[type="date"]'
    ) as HTMLInputElement;
    expect(date.value).toBe("2024-08-10");

    // Change the title and submit.
    text.value = "Renamed title";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const submit = queryAllDeep(
      form as unknown as WorkflowInstanceCard,
      "button"
    ).find((b) => b.textContent?.trim() === "Save");
    expect(submit).toBeDefined();
    submit?.dispatchEvent(click());
    await el.updateComplete;

    expect(JSON.parse(el.getAttribute("data-patch") ?? "{}")).toEqual({
      title: "Renamed title",
      due: "2024-08-10",
    });
    // The form closes after submit.
    expect(shadowRootOf(el).querySelector("config-field-form")).toBeNull();
  });

  it("renders state-path dots when history has transitions", async () => {
    const instance = entry("c1", "done", {
      history: [
        {
          type: "state_transition",
          fromState: "ready",
          toState: "done",
          timestamp: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    const el = await mount(card(undefined, instance));
    await settle(shadowRootOf(el));
    const dots = [...shadowRootOf(el).querySelectorAll(".state-dot")];
    expect(dots.length).toBeGreaterThan(1);
    expect(dots.at(-1)?.getAttribute("data-current")).toBe("true");
  });
});
