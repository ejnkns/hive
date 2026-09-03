import { html, LitElement } from "lit";
import { describe, expect, it, vi } from "vitest";
import { defineFlowRenderingComponents } from "../define-components.ts";
import { loadFlowComponents } from "../load-flow-components.ts";
import { cardDef, entry } from "../test-fixtures.ts";
import {
  click,
  mount,
  mustFind,
  queryAllDeep,
  settle,
  shadowRootOf,
} from "../test-utils.ts";
import { WorkflowInstances } from "./workflow-instances.ts";

// A served workflow-level custom view (WorkflowConfig.ui.workflowComponent):
// renders the workflow's ENTIRE workflow-instances section instead of the
// generic grouped board/list. Receives the full workflow-instance data plus
// the action/message/select callbacks and the cross-workflow state counts.
class FrontierBoard extends LitElement {
  static properties = {
    workflowDef: { attribute: false },
    entries: { attribute: false },
    customKinds: { attribute: false },
    workflowCounts: { attribute: false },
    onSelect: { attribute: false },
  };
  workflowDef: { label: string } = { label: "" };
  entries: Array<{ id: string }> = [];
  customKinds: unknown[] = [];
  workflowCounts: Array<{
    workflowId: string;
    label: string;
    total: number;
    waitingOnDependencies: number;
    dependenciesSatisfied: number;
  }> = [];
  onSelect: ((instanceId: string) => void) | undefined = undefined;
  render() {
    const siblingCounts = this.workflowCounts
      .map(
        (workflow) =>
          `${workflow.workflowId}:${workflow.total}` +
          `+waiting:${workflow.waitingOnDependencies}` +
          `+satisfied:${workflow.dependenciesSatisfied}`
      )
      .join(",");
    return html`<div class="frontier-board">
      <span class="frontier-summary-counts">${siblingCounts}</span>
      ${this.entries.map(
        (e) =>
          html`<button
            class="frontier-entry"
            @click=${() => this.onSelect?.(e.id)}
          >
            ${e.id}
          </button>`
      )}
    </div>`;
  }
}

function ticketsDef(workflowComponent?: string) {
  return cardDef({
    id: "tickets",
    label: "Tickets",
    ui: {
      view: "board",
      columns: [{ id: "ready", label: "Ready", states: ["ready"] }],
      ...(workflowComponent !== undefined ? { workflowComponent } : {}),
    },
  });
}

describe("WorkflowInstances workflowComponent (custom workflow view)", () => {
  it("renders the registered custom view for a declared workflowComponent", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "frontier-board": "/api/.../frontier-board" },
      async () => ({
        default: () => ({
          components: { "frontier-board": FrontierBoard },
        }),
      })
    );
    try {
      const def = ticketsDef("frontier-board");
      const a = entry("t-1", "ready");
      a.workflowId = "tickets";
      const b = entry("t-2", "ready");
      b.workflowId = "tickets";
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [def],
          instances: [a, b],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".frontier-entry").length).toBe(2);
      // The generic board/list content is replaced, not rendered underneath.
      expect(shadowRootOf(el).querySelector(".flow-board")).toBeNull();
    } finally {
      restore();
    }
  });

  it("passes cross-workflow state counts to the custom view", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "frontier-board": "/api/.../frontier-board" },
      async () => ({
        default: () => ({
          components: { "frontier-board": FrontierBoard },
        }),
      })
    );
    try {
      const def = ticketsDef("frontier-board");
      const ticket = entry("t-1", "ready");
      ticket.workflowId = "tickets";
      const other = entry("o-1", "ready");
      other.workflowId = "charting";
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [def, cardDef({ id: "charting", label: "Charting" })],
          instances: [ticket, other],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));
      // The custom view sees every workflow's count (including its own); it
      // filters its own out.
      const counts = mustFind(el, ".frontier-summary-counts");
      expect(counts.textContent).toContain("charting:1+waiting:0+satisfied:0");
      expect(counts.textContent).toContain("tickets:1+waiting:0+satisfied:0");
    } finally {
      restore();
    }
  });

  it("aggregates the engine dependency projection into waiting vs satisfied counts", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "frontier-board": "/api/.../frontier-board" },
      async () => ({
        default: () => ({
          components: { "frontier-board": FrontierBoard },
        }),
      })
    );
    try {
      const def = ticketsDef("frontier-board");
      const waiting = entry("t-1", "ready");
      waiting.workflowId = "tickets";
      waiting.dependencies = { blockers: ["t-2"], unsatisfied: ["t-2"] };
      const satisfied = entry("t-3", "ready");
      satisfied.workflowId = "tickets";
      satisfied.dependencies = { blockers: ["t-4"], unsatisfied: [] };
      const independent = entry("t-5", "ready");
      independent.workflowId = "tickets";
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [def],
          instances: [waiting, satisfied, independent],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));
      // One waiting entry, one with all blockers satisfied, one with no
      // recorded blockers (counts in neither aggregate).
      const counts = mustFind(el, ".frontier-summary-counts");
      expect(counts.textContent).toContain("tickets:3+waiting:1+satisfied:1");
    } finally {
      restore();
    }
  });

  it("falls back to the canonical board when workflowComponent is unknown", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    const a = entry("t-1", "ready");
    a.workflowId = "tickets";
    const el = await mount(
      Object.assign(new WorkflowInstances(), {
        flowId: "flow-1",
        workflowDefs: [ticketsDef("mystery-view")],
        instances: [a],
        customKinds: [],
      })
    );
    await settle(shadowRootOf(el));
    expect(shadowRootOf(el).querySelector(".flow-board")).not.toBeNull();
  });

  it("emits hive-select with ids when the custom view calls onSelect", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "frontier-board": "/api/.../frontier-board" },
      async () => ({
        default: () => ({
          components: { "frontier-board": FrontierBoard },
        }),
      })
    );
    try {
      const def = ticketsDef("frontier-board");
      const a = entry("t-1", "ready");
      a.workflowId = "tickets";
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [def],
          instances: [a],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));

      const emitted = new Promise<CustomEvent>((resolve) =>
        el.addEventListener("hive-select", resolve as EventListener, {
          once: true,
        })
      );
      const entryButton = mustFind(el, ".frontier-entry") as HTMLButtonElement;
      entryButton.dispatchEvent(click());
      const event = await emitted;
      expect(event.detail).toEqual({
        flowId: "flow-1",
        instanceId: "t-1",
      });
    } finally {
      restore();
    }
  });
});
