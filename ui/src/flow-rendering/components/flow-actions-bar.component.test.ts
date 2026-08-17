import { describe, expect, it } from "vitest";
import type { FlowLevelAction } from "../../flow-api.ts";
import {
  click,
  mount,
  queryAllDeep,
  settle,
  shadowRootOf,
} from "../test-utils.ts";
import { FlowActionsBar } from "./flow-actions-bar.ts";

function flowAction(
  id: string,
  label: string,
  variant: FlowLevelAction["variant"] = "primary",
  extra: Partial<FlowLevelAction> = {}
): FlowLevelAction {
  return { id, label, variant, ...extra };
}

function buttons(el: FlowActionsBar): HTMLButtonElement[] {
  return queryAllDeep(el, "button") as HTMLButtonElement[];
}

describe("FlowActionsBar", () => {
  it("renders one button per flow-level action", async () => {
    const el = await mount(
      Object.assign(new FlowActionsBar(), {
        actions: [
          flowAction("add_ticket", "Add ticket"),
          flowAction("start_build", "Start build", "secondary"),
        ],
      })
    );
    await settle(shadowRootOf(el));

    expect(buttons(el).map((b) => b.textContent?.trim())).toEqual([
      "Add ticket",
      "Start build",
    ]);
  });

  it("calls onCreate for a createInstance action", async () => {
    const created: string[] = [];
    const el = await mount(
      Object.assign(new FlowActionsBar(), {
        actions: [
          flowAction("add_ticket", "Add ticket", "primary", {
            createInstance: { workflowId: "ticket", fields: [] },
          }),
        ],
        onCreate: (id: string) => created.push(id),
      })
    );
    await settle(shadowRootOf(el));

    buttons(el)[0].dispatchEvent(click());
    await el.updateComplete;
    expect(created).toEqual(["add_ticket"]);
  });

  it("calls onFlowAction for a non-create action", async () => {
    const dispatched: string[] = [];
    const el = await mount(
      Object.assign(new FlowActionsBar(), {
        actions: [flowAction("start_build", "Start build")],
        onFlowAction: (id: string) => dispatched.push(id),
      })
    );
    await settle(shadowRootOf(el));

    buttons(el)[0].dispatchEvent(click());
    await el.updateComplete;
    expect(dispatched).toEqual(["start_build"]);
  });

  it("tags destructive actions so the shell styles them", async () => {
    const el = await mount(
      Object.assign(new FlowActionsBar(), {
        actions: [flowAction("rule_out", "Rule out", "destructive")],
      })
    );
    await settle(shadowRootOf(el));

    expect(buttons(el)[0].className).toBe("destructive");
  });
});
