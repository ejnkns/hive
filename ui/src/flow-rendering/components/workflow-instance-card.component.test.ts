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
