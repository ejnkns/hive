import { describe, expect, it } from "vitest";
import {
  click,
  mount,
  queryAllDeep,
  settle,
  shadowRootOf,
} from "../test-utils.ts";
import { FlowOverviewBar } from "./flow-overview.ts";
import type { FlowOverview } from "./workflow-instances/flow-overview.ts";

function overview(overrides: Partial<FlowOverview> = {}): FlowOverview {
  return {
    totals: {
      instances: 5,
      running: 1,
      waiting: 1,
      error: 1,
      terminal: 2,
      decisions: 2,
    },
    byWorkflow: [
      {
        workflowId: "ideas",
        label: "Ideas",
        total: 2,
        running: 0,
        waiting: 1,
        error: 0,
        terminal: 1,
        decisions: 0,
        status: "waiting",
      },
      {
        workflowId: "cards",
        label: "Cards",
        total: 3,
        running: 1,
        waiting: 0,
        error: 1,
        terminal: 1,
        decisions: 2,
        status: "error",
      },
    ],
    ...overrides,
  };
}

describe("FlowOverviewBar", () => {
  it("renders totals and one chip per workflow", async () => {
    const el = await mount(
      Object.assign(new FlowOverviewBar(), { overview: overview() })
    );
    await settle(shadowRootOf(el));

    const totals = [...shadowRootOf(el).querySelectorAll(".total")];
    expect(totals.map((t) => t.textContent?.trim())).toEqual([
      "5 instances",
      "1 running",
      "1 waiting",
      "1 error",
      "2 open decisions",
    ]);
    const chips = [...shadowRootOf(el).querySelectorAll(".chip")];
    const chipText = (c: Element) => (c.textContent ?? "").replace(/\s+/g, "");
    expect(chips.map(chipText)).toEqual(["Ideas2", "Cards32open"]);
  });

  it("omits zero totals", async () => {
    const el = await mount(
      Object.assign(new FlowOverviewBar(), {
        overview: overview({
          totals: {
            instances: 1,
            running: 0,
            waiting: 0,
            error: 0,
            terminal: 0,
            decisions: 0,
          },
        }),
      })
    );
    await settle(shadowRootOf(el));
    const totals = [...shadowRootOf(el).querySelectorAll(".total")];
    expect(totals.map((t) => t.textContent?.trim())).toEqual(["1 instances"]);
  });

  it("applies the status dot class per workflow", async () => {
    const el = await mount(
      Object.assign(new FlowOverviewBar(), { overview: overview() })
    );
    await settle(shadowRootOf(el));
    const dots = [...shadowRootOf(el).querySelectorAll(".chip .dot")];
    expect(dots.map((d) => d.className)).toEqual([
      "dot dot-waiting",
      "dot dot-error",
    ]);
  });

  it("emits hive-focus-workflow on chip click", async () => {
    const el = await mount(
      Object.assign(new FlowOverviewBar(), { overview: overview() })
    );
    await settle(shadowRootOf(el));

    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-focus-workflow", resolve as EventListener, {
        once: true,
      })
    );
    const cards = queryAllDeep(el, ".chip").find(
      (c) => c.textContent?.includes("Cards") === true
    );
    expect(cards).toBeDefined();
    cards?.dispatchEvent(click());
    expect((await emitted).detail).toEqual({ workflowId: "cards" });
  });
});
