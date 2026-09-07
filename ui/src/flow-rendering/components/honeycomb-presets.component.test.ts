// The honeycomb served modules, mounted through the fake evaluator pattern:
// the real preset component modules are evaluated against the app's lit
// runtime and registered, then asserted through the flow-component surface.
// These are behavior tests over the actual shipped components.

import { describe, expect, it, vi } from "vitest";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import type {
  FlowActionView,
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";
import flowComponentModule from "../../../../presets/honeycomb/ui/flow-component.ts";
import { defineFlowRenderingComponents } from "../define-components.ts";
import type { FlowComponentEvaluator } from "../load-flow-components.ts";
import { loadFlowComponents } from "../load-flow-components.ts";
import { action, cardDef, entry } from "../test-fixtures.ts";
import {
  click,
  mount,
  mustFind,
  queryAllDeep,
  queryDeep,
  settle,
  shadowRootOf,
  type,
} from "../test-utils.ts";
import { WorkflowInstances } from "./workflow-instances.ts";

// The preset module's default export IS the served factory; the fake
// evaluator wraps it in the module contract shape.
function load(
  factory: (deps: FlowComponentDeps) => FlowComponentRegistrations
): FlowComponentEvaluator {
  return async () => ({ default: factory });
}

// An ideas-workflow entry with the honeycomb card fields.
function idea(
  id: string,
  fields: Record<string, unknown>
): WorkflowInstanceEntry {
  const e = entry(id, "classified", { workflowInstanceState: { ...fields } });
  e.workflowId = "ideas";
  return e;
}

const IMPORT_ACTION: FlowActionView = {
  id: "import_notes",
  label: "Import notes",
  variant: "primary",
  createInstance: { workflowId: "imports", fields: [] },
};

// Mounts the served flow-component through the fake evaluator with the
// honeycomb workflow definitions and the given instances.
async function mountHoneycomb(
  instances: WorkflowInstanceEntry[],
  options: {
    persistedOutputs?: Record<string, string>;
    availableFlowActions?: FlowActionView[];
  } = {}
) {
  defineFlowRenderingComponents();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, text: async () => "" }))
  );
  const restore = await loadFlowComponents(
    { "flow-component": "/api/.../flow-component" },
    load(flowComponentModule)
  );
  const ideas = cardDef({ id: "ideas", label: "Ideas" });
  const imports = cardDef({ id: "imports", label: "Imports" });
  const organize = cardDef({ id: "organize", label: "Map" });
  const el = await mount(
    Object.assign(new WorkflowInstances(), {
      flowId: "flow-1",
      flow: {
        id: "flow-1",
        label: "Honeycomb",
        status: "idle",
        config: {},
      },
      flowComponent: "flow-component",
      workflowDefs: [ideas, imports, organize],
      instances,
      customKinds: [],
      availableFlowActions: options.availableFlowActions ?? [IMPORT_ACTION],
      persistedOutputs: options.persistedOutputs ?? {},
      persistedOutputDirs: {},
    })
  );
  await settle(shadowRootOf(el));
  return { el, restore };
}

describe("honeycomb served modules", () => {
  it("an empty comb renders the empty state with the import invitation", async () => {
    const { el, restore } = await mountHoneycomb([]);
    try {
      const empty = queryDeep(el, ".camp");
      expect(empty).not.toBeNull();
      expect(queryAllDeep(el, ".camp h1")[0]?.textContent).toContain(
        "Honeycomb"
      );
      const importButton = mustFind(el, ".camp button");
      expect(importButton.textContent?.trim()).toBe("Import notes");
      // The brand still renders.
      expect(queryDeep(el, ".brand h1")?.textContent).toContain("Honeycomb");
      // No surface, no map toggle.
      expect(queryDeep(el, ".world")).toBeNull();
      expect(queryDeep(el, ".hud-actions button[aria-pressed]")).toBeNull();
    } finally {
      restore();
    }
  });

  it("the empty state's import invitation routes through the hive-create seam", async () => {
    const { el, restore } = await mountHoneycomb([]);
    try {
      const created: Array<{ flowId: string; actionId: string }> = [];
      el.addEventListener("hive-create", (event) => {
        created.push((event as CustomEvent).detail);
      });
      mustFind(el, ".camp button").dispatchEvent(click());
      expect(created[0]).toMatchObject({
        flowId: "flow-1",
        actionId: "import_notes",
      });
    } finally {
      restore();
    }
  });

  it("the comb renders a hive per category and a cell per idea with its status class", async () => {
    const { el, restore } = await mountHoneycomb([
      idea("i-1", {
        title: "Split the parser",
        category: "Parsing",
        status: "in-progress",
      }),
      idea("i-2", {
        title: "Ship scoring",
        category: "Scoring",
        status: "done",
      }),
      idea("i-3", { title: "Unfiled thought", status: "backlog" }),
    ]);
    try {
      // Alphabetical hives, Uncategorized last.
      const labels = queryAllDeep(el, ".hive-label").map((el) =>
        el.textContent?.trim()
      );
      expect(labels).toEqual(["Parsing", "Scoring", "Uncategorized"]);
      expect(
        queryAllDeep(el, ".hive-count")[0]?.textContent?.replace(/\s+/g, " ")
      ).toContain("1 idea");
      // Cells render with their status classes and titles.
      const cell = mustFind(el, '[data-cell="i-1"]');
      expect(cell.className).toContain("status-in-progress");
      expect(cell.textContent).toContain("Split the parser");
      expect(mustFind(el, '[data-cell="i-2"]').className).toContain(
        "status-done"
      );
      expect(mustFind(el, '[data-cell="i-3"]').className).toContain(
        "status-backlog"
      );
      // The Map toggle exists once there is content.
      expect(queryDeep(el, ".hud-actions button[aria-pressed]")).not.toBeNull();
      // The detail is closed.
      expect(queryDeep(el, ".detail")).toBeNull();
    } finally {
      restore();
    }
  });

  it("clicking a cell opens the flipped detail in place; the scrim closes it", async () => {
    const selected = idea("i-1", {
      title: "Split the parser",
      category: "Parsing",
      status: "backlog",
      summary: "Split the digest into classified ideas.",
      tags: ["engine"],
      originalText: "the raw paste text",
    });
    selected.availableActions = [
      action("markDone", "Mark done", "primary"),
      action("park", "Park", "secondary"),
      action("discard", "Discard", "destructive"),
    ];
    const { el, restore } = await mountHoneycomb([selected]);
    try {
      mustFind(el, '[data-cell="i-1"]').dispatchEvent(click());
      await settle(shadowRootOf(el));
      const detail = mustFind(el, ".detail");
      expect(detail.getAttribute("data-cell")).toBe("i-1");
      const back = queryDeep(el, ".face.back")!;
      expect(back.textContent).toContain("Split the parser");
      expect(back.textContent).toContain("Split the digest");
      // The actions render from the entry's availableActions.
      const buttons = queryAllDeep(el, ".actions button");
      expect(buttons.map((b) => b.textContent?.trim())).toEqual([
        "Mark done",
        "Park",
        "Discard",
      ]);
      // The original notes render collapsed in a details element.
      expect(queryDeep(el, ".original")).not.toBeNull();
      // The scrim closes it.
      queryDeep(el, ".scrim")!.dispatchEvent(click());
      await settle(shadowRootOf(el));
      expect(queryDeep(el, ".detail")).toBeNull();
    } finally {
      restore();
    }
  });

  it("the detail's field edits and actions route through the generic seams", async () => {
    const selected = idea("i-1", {
      title: "Split the parser",
      category: "Parsing",
      status: "backlog",
      tags: ["engine"],
    });
    const sibling = idea("i-2", {
      title: "Ship scoring",
      category: "Scoring",
    });
    selected.availableActions = [action("markDone", "Mark done", "primary")];
    const { el, restore } = await mountHoneycomb([selected, sibling]);
    try {
      const patched: Array<{
        instanceId: string;
        values: Record<string, unknown>;
      }> = [];
      const actions: Array<{ instanceId: string; actionId: string }> = [];
      el.addEventListener("hive-patch-state", (event) => {
        patched.push((event as CustomEvent).detail);
      });
      el.addEventListener("hive-action", (event) => {
        actions.push((event as CustomEvent).detail);
      });
      mustFind(el, '[data-cell="i-1"]').dispatchEvent(click());
      await settle(shadowRootOf(el));

      const status = mustFind(el, "#hc-status") as HTMLSelectElement;
      status.value = "in-progress";
      status.dispatchEvent(new Event("change", { bubbles: true }));
      await settle(shadowRootOf(el));
      expect(patched[0]).toMatchObject({
        instanceId: "i-1",
        values: { status: "in-progress" },
      });

      const category = mustFind(el, "#hc-category") as HTMLSelectElement;
      category.value = "Scoring";
      category.dispatchEvent(new Event("change", { bubbles: true }));
      await settle(shadowRootOf(el));
      expect(patched[1]?.values).toMatchObject({ category: "Scoring" });

      // Tags commit as a comma list on change.
      const tags = mustFind(el, "#hc-tags") as HTMLInputElement;
      await type(tags, "engine, parser ,");
      tags.dispatchEvent(new Event("change", { bubbles: true }));
      await settle(shadowRootOf(el));
      expect(patched[2]?.values).toMatchObject({ tags: ["engine", "parser"] });

      mustFind(el, ".actions button.primary").dispatchEvent(click());
      await settle(shadowRootOf(el));
      expect(actions[0]).toMatchObject({
        instanceId: "i-1",
        actionId: "markDone",
      });
      // Dispatching an action closes the detail.
      expect(queryDeep(el, ".detail")).toBeNull();

      // Reopening the same cell does not replay the entrance (a data churn
      // re-delivers the same idea as a fresh object).
      mustFind(el, '[data-cell="i-1"]').dispatchEvent(click());
      await settle(shadowRootOf(el));
      expect(queryDeep(el, ".detail")).not.toBeNull();
    } finally {
      restore();
    }
  });

  it("the Map toggle opens the map.md side panel with the persisted document", async () => {
    const { el, restore } = await mountHoneycomb(
      [idea("i-1", { title: "One", category: "Parsing" })],
      {
        persistedOutputs: { "map.md": "# The map\n\n- Parsing: one idea" },
      }
    );
    try {
      const mapButton = mustFind(el, ".hud-actions button[aria-pressed]");
      const shell = shellHost(el);
      // Closed: the shell carries no map-open attribute; the panel is
      // translated off-screen by the transform rule.
      expect(shell.hasAttribute("data-map-open")).toBe(false);
      mapButton.dispatchEvent(click());
      await settle(shadowRootOf(el));
      expect(shell.getAttribute("data-map-open")).toBe("");
      const pre = queryDeep(el, ".map-panel pre")!;
      expect(pre.textContent).toContain("# The map");
      expect(pre.textContent).toContain("one idea");
    } finally {
      restore();
    }
  });

  it("a missing map.md renders the panel's empty hint", async () => {
    const { el, restore } = await mountHoneycomb([
      idea("i-1", { title: "One", category: "Parsing" }),
    ]);
    try {
      mustFind(el, ".hud-actions button[aria-pressed]").dispatchEvent(click());
      await settle(shadowRootOf(el));
      const pre = queryDeep(el, ".map-panel pre")!;
      expect(pre.className).toContain("empty");
      expect(pre.textContent).toContain("No map built yet");
    } finally {
      restore();
    }
  });

  it("clicking a hive tweens the camera in (the reset control appears)", async () => {
    const { el, restore } = await mountHoneycomb([
      idea("i-1", { title: "One", category: "Parsing" }),
      idea("i-2", { title: "Two", category: "Parsing" }),
      idea("i-3", { title: "Three", category: "Scoring" }),
    ]);
    try {
      const surface = worldSurface(el);
      Object.defineProperty(surface, "clientWidth", {
        value: 800,
        configurable: true,
      });
      Object.defineProperty(surface, "clientHeight", {
        value: 600,
        configurable: true,
      });
      const world = queryDeep(el, ".world") as HTMLElement;
      const before = world.style.transform;
      const hive = mustFind(el, '[data-hive="Parsing"]');
      hive.dispatchEvent(click());
      // The camera eases toward the patch fit over a few frames.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const after = world.style.transform;
      expect(after).not.toBe(before);
      expect(after).toContain("scale");
      // The reset control appeared (zoomed past the fit-all overview).
      const reset = queryDeep(el, ".reset") as HTMLElement;
      expect(reset.hidden).toBe(false);
      reset.dispatchEvent(click());
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(reset.hidden).toBe(true);
    } finally {
      restore();
    }
  });
  it("opening a cell does not yank the camera back to the overview", async () => {
    const { el, restore } = await mountHoneycomb([
      idea("i-1", { title: "One", category: "Parsing" }),
      idea("i-2", { title: "Two", category: "Parsing" }),
      idea("i-3", { title: "Three", category: "Scoring" }),
    ]);
    try {
      const surface = worldSurface(el);
      Object.defineProperty(surface, "clientWidth", {
        value: 800,
        configurable: true,
      });
      Object.defineProperty(surface, "clientHeight", {
        value: 600,
        configurable: true,
      });
      const world = mustFind(el, ".world") as HTMLElement;
      const overview = world.style.transform;
      // Zoom into a hive.
      mustFind(el, '[data-hive="Parsing"]').dispatchEvent(click());
      await new Promise((resolve) => setTimeout(resolve, 700));
      const zoomed = world.style.transform;
      expect(zoomed).not.toBe(overview);
      // Opening a cell re-renders the shell but must not re-derive the map
      // (a fresh identity would re-fit the camera — the "click zooms the
      // map out" bug).
      mustFind(el, '[data-cell="i-1"]').dispatchEvent(click());
      await settle(shadowRootOf(el));
      await new Promise((resolve) => setTimeout(resolve, 300));
      // The camera keeps easing toward its goal after the zoomed capture;
      // what matters is it did not jump back to the overview.
      const scaleOf = (transform: string): number =>
        Number(/scale\(([0-9.]+)\)/.exec(transform)?.[1] ?? 0);
      expect(
        Math.abs(scaleOf(world.style.transform) - scaleOf(zoomed))
      ).toBeLessThan(0.02);
      expect(queryDeep(el, ".detail")).not.toBeNull();
    } finally {
      restore();
    }
  });
});

// The comb surface element (a generated-tag served element): the shadow host
// of the rendered .world surface.
function worldSurface(el: WorkflowInstances): HTMLElement {
  const world = mustFind(el, ".world") as HTMLElement;
  return (world.getRootNode() as ShadowRoot).host as HTMLElement;
}

// The comb-shell element instance (the shadow host of the .brand header).
function shellHost(el: WorkflowInstances): HTMLElement {
  const brand = mustFind(el, ".brand") as HTMLElement;
  return (brand.getRootNode() as ShadowRoot).host as HTMLElement;
}
