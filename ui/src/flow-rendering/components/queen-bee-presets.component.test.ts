// The queen-bee served modules (the non-wayfinder preset), mounted through
// the fake evaluator pattern: the real preset component module is evaluated
// against the app's lit runtime and registered, then asserted through the
// workflow-instances surface. Ticket 16: the idea card is the proof the
// shared utility vocabulary is engine-generic — the same composition rule
// the wayfinder preset follows, with no wayfinder tokens involved.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";
import ideaCardModule from "../../../../presets/queen-bee/ideas/idea-card.ts";
import { defineFlowRenderingComponents } from "../define-components.ts";
import type { FlowComponentEvaluator } from "../load-flow-components.ts";
import { loadFlowComponents } from "../load-flow-components.ts";
import { cardDef, entry } from "../test-fixtures.ts";
import { mount, queryAllDeep, settle, shadowRootOf } from "../test-utils.ts";
import { WorkflowInstances } from "./workflow-instances.ts";

// The preset module's default export IS the served factory.
function load(
  factory: (deps: FlowComponentDeps) => FlowComponentRegistrations
): FlowComponentEvaluator {
  return async () => ({ default: factory });
}

function ideasDef() {
  return cardDef({
    id: "ideas",
    label: "Ideas",
    states: [
      {
        id: "new",
        label: "New",
        category: "initial",
        actions: [{ id: "elaborate", label: "Elaborate", variant: "primary" }],
        tasks: [],
      },
    ],
    ui: { view: "list", instanceComponent: "idea-card" },
  });
}

describe("queen-bee served modules", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("idea-card styles with the injected utility vocabulary", async () => {
    defineFlowRenderingComponents();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "idea-card": "/api/.../idea-card" },
      load(ideaCardModule)
    );
    try {
      const idea = entry("i-1", "new");
      idea.workflowId = "ideas";
      idea.state.workflowInstanceState = { title: "Session memory ledger" };
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [ideasDef()],
          instances: [idea],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));

      const card = queryAllDeep(el, ".idea")[0];
      expect(card?.classList.contains("border")).toBe(true);
      expect(card?.classList.contains("rounded-lg")).toBe(true);
      expect(card?.classList.contains("bg-surface")).toBe(true);
      expect(card?.classList.contains("flex")).toBe(true);
      expect(card?.classList.contains("flex-col")).toBe(true);
      expect(card?.classList.contains("gap-2")).toBe(true);
      const title = queryAllDeep(el, ".idea-title")[0];
      expect(title?.classList.contains("text-base")).toBe(true);
      expect(title?.classList.contains("font-bold")).toBe(true);
      expect(title?.textContent).toBe("Session memory ledger");
      const state = queryAllDeep(el, ".idea-state")[0];
      expect(state?.classList.contains("uppercase")).toBe(true);
      expect(state?.classList.contains("text-muted")).toBe(true);
    } finally {
      restore();
    }
  });
});
