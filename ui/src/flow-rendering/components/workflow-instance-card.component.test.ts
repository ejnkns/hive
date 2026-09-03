import { beforeAll, describe, expect, it } from "vitest";
import { defineFlowRenderingComponents } from "../define-components.ts";
import { action, cardDef, entry } from "../test-fixtures.ts";
import {
  click,
  mount,
  mustFind,
  mustQuery,
  queryAllDeep,
  settle,
  shadowRootOf,
} from "../test-utils.ts";
import { WorkflowInstanceCard } from "./workflow-instance-card.ts";

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
  it("styles with the shared utility vocabulary", async () => {
    // Ticket 15: the default card composes the injected utility sheet.
    const def = cardDef({
      display: { fields: [{ path: "cardSpec.title", label: "Title" }] },
    });
    const el = await mount(card(def));
    await settle(shadowRootOf(el));
    const item = mustFind(el, ".domain-data-item");
    for (const utility of ["flex", "flex-col"]) {
      expect(item.classList.contains(utility)).toBe(true);
    }
    const key = mustFind(el, ".domain-data-key");
    expect(key.classList.contains("text-accent")).toBe(true);
  });

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
          tasks: [
            {
              id: "plan",
              label: "Plan",
              role: "ai-task",
              render: { kind: "markdown" },
            },
          ],
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

  it("renders an array display field as joined comma-separated text", async () => {
    const def = cardDef({
      display: { fields: [{ path: "tags", label: "Tags" }] },
    });
    const instance = entry("c1", "ready", {
      workflowInstanceState: { tags: ["a11y", "offline", "sync"] },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    const values = [...shadowRootOf(el).querySelectorAll(".domain-data-value")];
    expect(values.map((v) => v.textContent)).toEqual(["a11y, offline, sync"]);
  });

  it("renders an empty array display field as an empty value", async () => {
    const def = cardDef({
      display: { fields: [{ path: "tags", label: "Tags" }] },
    });
    const instance = entry("c1", "ready", {
      workflowInstanceState: { tags: [] },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    const values = [...shadowRootOf(el).querySelectorAll(".domain-data-value")];
    expect(values.map((v) => v.textContent)).toEqual([""]);
  });

  it("falls back to JSON for an array display field containing objects", async () => {
    const def = cardDef({
      display: { fields: [{ path: "items", label: "Items" }] },
    });
    const instance = entry("c1", "ready", {
      workflowInstanceState: { items: [{ name: "alpha" }, { name: "beta" }] },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    const values = [...shadowRootOf(el).querySelectorAll(".domain-data-value")];
    expect(values[0]?.textContent).toContain('"name"');
    expect(values[0]?.textContent).toContain("alpha");
  });

  it("renders the Session-data fallback array as joined text", async () => {
    const instance = entry("c1", "ready", {
      workflowInstanceState: { tags: ["one", "two"] },
    });
    const el = await mount(card(undefined, instance));
    await settle(shadowRootOf(el));
    const values = [...shadowRootOf(el).querySelectorAll(".domain-data-value")];
    expect(values.map((v) => v.textContent)).toEqual(["one, two"]);
  });

  it("hides a successful operation output without a render hint", async () => {
    const def = cardDef({
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [],
          tasks: [{ id: "extract", label: "Extract", role: "operation" }],
        },
      ],
    });
    const instance = entry("c1", "ready", {
      taskOutputs: {
        extract: { status: "success", output: { note: "bookkeeping" } },
      },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    // No output item, and no panel at all when every output is hidden.
    expect(shadowRootOf(el).querySelector(".output-item")).toBeNull();
    expect(shadowRootOf(el).querySelector(".task-outputs")).toBeNull();
  });

  it("renders ai-task outputs while hiding operation bookkeeping", async () => {
    const def = cardDef({
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [],
          tasks: [
            { id: "extract", label: "Extract", role: "operation" },
            { id: "plan", label: "Plan", role: "ai-task" },
          ],
        },
      ],
    });
    const instance = entry("c1", "ready", {
      taskOutputs: {
        extract: { status: "success", output: { note: "bookkeeping" } },
        plan: { status: "success", output: "a plan" },
      },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    const items = [...shadowRootOf(el).querySelectorAll(".output-item")];
    expect(items.length).toBe(1);
    expect(items[0]?.querySelector(".output-task-id")?.textContent).toBe(
      "Plan"
    );
  });

  it("renders a successful operation output per its render hint", async () => {
    const def = cardDef({
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [],
          tasks: [
            {
              id: "summary",
              label: "Summary",
              role: "operation",
              render: { kind: "markdown" },
            },
          ],
        },
      ],
    });
    const instance = entry("c1", "ready", {
      taskOutputs: {
        summary: { status: "success", output: "# Wrapped up" },
      },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    const markdown = mustFind(el, "markdown-view");
    expect(mustQuery(shadowRootOf(markdown), ".markdown h1").textContent).toBe(
      "Wrapped up"
    );
  });

  it("renders an operation task error even without a render hint", async () => {
    const def = cardDef({
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [],
          tasks: [{ id: "extract", label: "Extract", role: "operation" }],
        },
      ],
    });
    const instance = entry("c1", "ready", {
      taskOutputs: {
        extract: { status: "error", error: "op failed", output: {} },
      },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    const items = [...shadowRootOf(el).querySelectorAll(".output-item")];
    expect(items.length).toBe(1);
    expect(items[0]?.querySelector(".output-status")?.textContent).toBe(
      "error"
    );
    expect(mustFind(el, "task-error-view")).toBeTruthy();
  });

  it("renders a chips render hint over an array of strings as pills", async () => {
    const def = cardDef({
      display: {
        fields: [{ path: "tags", label: "Tags", render: { kind: "chips" } }],
      },
    });
    const instance = entry("c1", "ready", {
      workflowInstanceState: { tags: ["a11y", "offline", "sync"] },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    const chips = mustFind(el, "chips-view");
    const pills = [...shadowRootOf(chips).querySelectorAll(".chip")];
    expect(pills.map((p) => p.textContent)).toEqual([
      "a11y",
      "offline",
      "sync",
    ]);
  });

  it("falls back to raw rendering when the chips kind receives a non-array", async () => {
    const def = cardDef({
      display: {
        fields: [{ path: "note", label: "Note", render: { kind: "chips" } }],
      },
    });
    const instance = entry("c1", "ready", {
      workflowInstanceState: { note: "plain string" },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));
    // The contract mismatch (string bound to an array prop) falls back to
    // json rendering; chips-view is never mounted.
    expect(shadowRootOf(el).querySelector("chips-view")).toBeNull();
    const json = mustFind(el, "json-view");
    expect(shadowRootOf(json).textContent).toContain("plain string");
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

  it("renders derived display values (count and progress bar)", async () => {
    const def = cardDef({
      display: {
        fields: [
          {
            path: "items",
            label: "Done",
            derive: {
              kind: "progress",
              where: { field: "status", equals: "done" },
            },
          },
          { path: "items", label: "Total", derive: { kind: "count" } },
        ],
      },
    });
    const instance = entry("c1", "ready", {
      workflowInstanceState: {
        items: [{ status: "done" }, { status: "done" }, { status: "pending" }],
      },
    });
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));

    const keys = [...shadowRootOf(el).querySelectorAll(".domain-data-key")];
    expect(keys.map((k) => k.textContent)).toEqual(["Done", "Total"]);
    expect(
      shadowRootOf(el).querySelector(".domain-progress-text")?.textContent
    ).toBe("2 of 3");
    expect(
      shadowRootOf(el).querySelector(".domain-progress-fill")
    ).not.toBeNull();
    const values = [...shadowRootOf(el).querySelectorAll(".domain-data-value")];
    expect(values.map((v) => v.textContent)).toEqual(["3"]);
  });

  it("renders across-instance derives from the workflow summary", async () => {
    const def = cardDef({
      display: {
        fields: [
          {
            path: "status",
            label: "In review",
            derive: { kind: "countAcross", equals: "review" },
          },
          {
            path: "status",
            label: "Review bar",
            derive: { kind: "progressAcross", equals: "review" },
          },
        ],
      },
    });
    const instance = entry("c1", "ready", {
      workflowInstanceState: { status: "review" },
    });
    instance.workflowSummary = {
      total: 4,
      byField: { status: { pending: 1, review: 2, done: 1 } },
    };
    const el = await mount(card(def, instance));
    await settle(shadowRootOf(el));

    const keys = [...shadowRootOf(el).querySelectorAll(".domain-data-key")];
    expect(keys.map((k) => k.textContent)).toEqual(["In review", "Review bar"]);
    const values = [...shadowRootOf(el).querySelectorAll(".domain-data-value")];
    expect(values.map((v) => v.textContent)).toEqual(["2"]);
    expect(
      shadowRootOf(el).querySelector(".domain-progress-text")?.textContent
    ).toBe("2 of 4");
  });

  it("falls back to the raw value when a derive cannot evaluate", async () => {
    const def = cardDef({
      display: {
        fields: [
          { path: "cardSpec.title", label: "Title", derive: { kind: "count" } },
        ],
      },
    });
    const el = await mount(card(def));
    await settle(shadowRootOf(el));

    const values = [...shadowRootOf(el).querySelectorAll(".domain-data-value")];
    expect(values.map((v) => v.textContent)).toEqual(["Card c1"]);
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
