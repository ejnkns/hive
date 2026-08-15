import { beforeAll, describe, expect, it } from "vitest";
import { defineFlowRenderingComponents } from "../define-components.ts";
import { action, boardDef, cardDef, entry } from "../test-fixtures.ts";
import {
  click,
  mount,
  mustFind,
  mustQuery,
  settle,
  shadowRootOf,
} from "../test-utils.ts";
import { WorkflowInstances } from "./workflow-instances.ts";

// Behavior tests for the board/list rendering surface: curated columns,
// default per-state columns, flat views, collapse, and action bubbling.

beforeAll(() => {
  // The card template references default components (item-header, action-bar,
  // markdown-view) that the app defines once at boot via this call.
  defineFlowRenderingComponents();
});

function host(def = cardDef(), instances = [entry("c1", "ready")]) {
  return Object.assign(new WorkflowInstances(), {
    flowId: "flow-1",
    workflowDefs: [def],
    instances,
    customKinds: [],
  });
}

describe("WorkflowInstances board rendering", () => {
  it("renders curated columns from ui.columns in declaration order", async () => {
    const def = boardDef([
      { id: "ready", label: "Ready", states: ["ready"] },
      {
        id: "in_progress",
        label: "In Progress",
        states: ["in_progress", "done"],
      },
    ]);
    const el = await mount(
      host(def, [
        entry("a", "ready"),
        entry("b", "in_progress"),
        entry("c", "done"),
      ])
    );
    await settle(shadowRootOf(el));

    const headers = [...shadowRootOf(el).querySelectorAll(".column-header")];
    expect(
      headers.map((h) => h.querySelector(".column-label")?.textContent)
    ).toEqual(["Ready", "In Progress"]);
    const counts = headers.map(
      (h) => h.querySelector(".column-count")?.textContent
    );
    expect(counts).toEqual(["1", "2"]);
    // Folding: the done instance lands in the In Progress column (cards mount
    // inside dynamic-element-host, so count the hosts in the column body).
    const inProgressColumn = headers[1]?.parentElement;
    expect(
      inProgressColumn?.querySelectorAll("dynamic-element-host").length
    ).toBe(2);
  });

  it("renders one column per state when no columns are declared", async () => {
    const el = await mount(host(cardDef(), [entry("a", "ready")]));
    await settle(shadowRootOf(el));
    const headers = [...shadowRootOf(el).querySelectorAll(".column-label")];
    expect(headers.map((h) => h.textContent)).toEqual([
      "Ready",
      "In Progress",
      "Done",
    ]);
  });

  it("renders a flat list for the list view", async () => {
    const def = cardDef({ ui: { view: "list" } });
    const el = await mount(
      host(def, [entry("a", "ready"), entry("b", "done")])
    );
    await settle(shadowRootOf(el));
    expect(shadowRootOf(el).querySelector(".flow-board")).toBeNull();
    expect(shadowRootOf(el).querySelector(".flow-list")).not.toBeNull();
    expect(
      shadowRootOf(el).querySelectorAll(".flow-list dynamic-element-host")
        .length
    ).toBe(2);
  });

  it("collapses a workflow section on header click and persists it", async () => {
    localStorage.clear();
    const el = await mount(host());
    await settle(shadowRootOf(el));
    expect(shadowRootOf(el).querySelector(".flow-board")).not.toBeNull();

    const header = mustQuery(shadowRootOf(el), ".flow-header") as HTMLElement;
    header.dispatchEvent(click());
    await el.updateComplete;

    expect(shadowRootOf(el).querySelector(".flow-board")).toBeNull();
    expect(localStorage.getItem("hive:collapse:flow-1:cards")).toBe("1");

    // A fresh element with the same flow id restores the collapsed state.
    const el2 = await mount(host());
    await settle(shadowRootOf(el2));
    expect(shadowRootOf(el2).querySelector(".flow-board")).toBeNull();
  });

  it("bubbles a card action click as a hive-action with ids", async () => {
    // The collapse test above persists this flow's section as collapsed in
    // localStorage; clear so the board renders for this test.
    localStorage.clear();
    const def = cardDef({
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [{ id: "run", label: "Run Worker", variant: "primary" }],
          tasks: [],
        },
      ],
    });
    const instance = entry("c1", "ready");
    instance.availableActions = [action("run", "Run Worker")];
    const el = await mount(host(def, [instance]));
    await settle(shadowRootOf(el));

    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-action", resolve as EventListener, {
        once: true,
      })
    );
    // The action button lives in the card's action-bar shadow; the first
    // button in the host's own shadow is the section header toggle.
    const button = mustQuery(
      shadowRootOf(mustFind(el, "action-bar")),
      "button"
    ) as HTMLButtonElement;
    button.dispatchEvent(click());
    const event = await emitted;
    expect(event.detail).toEqual({
      flowId: "flow-1",
      instanceId: "c1",
      actionId: "run",
    });
  });

  it("carries the action payload through the hive-action event", async () => {
    localStorage.clear();
    const def = cardDef({
      states: [
        {
          id: "ready",
          label: "Ready",
          category: "initial",
          actions: [],
          tasks: [],
        },
      ],
    });
    const instance = entry("c1", "ready");
    instance.availableActions = [];
    const el = await mount(host(def, [instance]));
    await settle(shadowRootOf(el));

    // Drive the custom component's onAction prop directly — the flow-editor's
    // Instantiate flow button emits with a payload ({ id }).
    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-action", resolve as EventListener, {
        once: true,
      })
    );
    const dynamicHost = mustFind(el, "dynamic-element-host");
    const hostEl = dynamicHost as unknown as {
      props?: {
        onAction?: (id: string, payload?: Record<string, unknown>) => void;
      };
    };
    const onAction = hostEl.props?.onAction;
    expect(typeof onAction).toBe("function");
    onAction?.("instantiate", { id: "review-flow" });
    const event = await emitted;
    expect(event.detail).toMatchObject({
      flowId: "flow-1",
      instanceId: "c1",
      actionId: "instantiate",
      payload: { id: "review-flow" },
    });
  });
});
