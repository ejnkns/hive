import { html, LitElement } from "lit";
import { describe, expect, it, vi } from "vitest";
import { defineFlowRenderingComponents } from "../define-components";
import { loadFlowComponents } from "../load-flow-components";
import { cardDef, entry } from "../test-fixtures";
import {
  click,
  mount,
  mustQuery,
  queryAllDeep,
  settle,
  shadowRootOf,
} from "../test-utils";
import { WorkflowInstances } from "./workflow-instances";

// A served custom component (like the ideas idea-card) so the collapse/reopen
// path runs against a custom instance component too.
class IdeaCard extends LitElement {
  static properties = {
    workflowDef: { attribute: false },
    instanceEntry: { attribute: false },
  };
  workflowDef: unknown = null;
  instanceEntry: { id: string } = { id: "" };
  render() {
    return html`<div class="idea-card">idea ${this.instanceEntry.id}</div>`;
  }
}

function ideasDef() {
  return cardDef({
    id: "ideas",
    label: "Ideas",
    ui: { view: "list", instanceComponent: "idea-card" },
  });
}

describe("WorkflowInstances collapse/reopen", () => {
  it("keeps list-view instances visible after collapse and reopen", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "idea-card": "/api/.../idea-card" },
      async () => ({
        default: () => ({ components: { "idea-card": IdeaCard } }),
      })
    );

    try {
      const idea = entry("idea-1", "backlog");
      idea.workflowId = "ideas";
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [ideasDef()],
          instances: [idea],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".idea-card").length).toBe(1);

      // collapse
      const header = mustQuery(shadowRootOf(el), ".flow-header") as HTMLElement;
      header.dispatchEvent(click());
      await el.updateComplete;
      expect(shadowRootOf(el).querySelector(".flow-list")).toBeNull();

      // reopen
      mustQuery(shadowRootOf(el), ".flow-header").dispatchEvent(click());
      await el.updateComplete;
      await settle(shadowRootOf(el));
      expect(shadowRootOf(el).querySelector(".flow-list")).not.toBeNull();
      expect(queryAllDeep(el, ".idea-card").length).toBe(1);
    } finally {
      restore();
    }
  });
});
