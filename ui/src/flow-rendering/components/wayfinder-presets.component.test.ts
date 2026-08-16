// The wayfinder served modules (W3), mounted through the fake evaluator
// pattern: the real preset component modules are evaluated against the app's
// lit runtime and registered, then asserted through the workflow-instances
// surface. These are behavior tests over the actual shipped components.

import { describe, expect, it, vi } from "vitest";
import type {
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";
import buildItemCardModule from "../../../../presets/wayfinder/ui/build-item-card.ts";
import expeditionMapModule from "../../../../presets/wayfinder/ui/expedition-map.ts";
import frontierBoardModule from "../../../../presets/wayfinder/ui/frontier-board.ts";
import ticketCardModule from "../../../../presets/wayfinder/ui/ticket-card.ts";
import { defineFlowRenderingComponents } from "../define-components.ts";
import type { FlowComponentEvaluator } from "../load-flow-components.ts";
import { loadFlowComponents } from "../load-flow-components.ts";
import { cardDef, entry } from "../test-fixtures.ts";
import {
  mount,
  mustFind,
  queryAllDeep,
  settle,
  shadowRootOf,
} from "../test-utils.ts";
import { WorkflowInstances } from "./workflow-instances.ts";

// The preset modules' default export IS the served factory; the fake
// evaluator wraps it in the module contract shape.
function load(
  factory: (deps: FlowComponentDeps) => FlowComponentRegistrations
): FlowComponentEvaluator {
  return async () => ({ default: factory });
}

// The wayfinder ticket workflow shape: curated board columns + the served
// ticket card as the instance component.
function ticketDef(overrides: Record<string, unknown> = {}) {
  return cardDef({
    id: "ticket",
    label: "Ticket",
    instance: { title: "title" },
    ui: {
      view: "board",
      instanceComponent: "ticket-card",
      columns: [
        { id: "fog", label: "Fog", states: ["fog"] },
        { id: "frontier", label: "Frontier", states: ["ready"] },
        {
          id: "resolving",
          label: "Resolving",
          states: ["resolving_research", "recording"],
        },
        { id: "closed", label: "Closed", states: ["closed"] },
      ],
    },
    ...overrides,
  });
}

function ticketEntry(id: string, currentState: string) {
  const e = entry(id, currentState);
  e.workflowId = "ticket";
  return e;
}

describe("wayfinder served modules", () => {
  it("ticket-card renders type badge, question, dependsOn chips, and the research findings preview", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "ticket-card": "/api/.../ticket-card" },
      load(ticketCardModule)
    );
    try {
      const instance = ticketEntry("t-1", "resolving_research");
      instance.state.workflowInstanceState = {
        title: "Pick the routing layer",
        question: "Which router do we standardize on?",
        type: "research",
        dependsOn: ["t-3", "t-4"],
      };
      instance.state.taskOutputs = {
        research: {
          status: "success",
          output: {
            question: "Which router do we standardize on?",
            findings: "Excalibur wins on the two axes that matter.",
            sources: ["https://excalibur.dev", "https://docs.example/router"],
          },
        },
      };
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [ticketDef()],
          instances: [instance],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));

      expect(queryAllDeep(el, ".type-badge")[0]?.textContent).toBe("research");
      expect(queryAllDeep(el, ".ticket-question")[0]?.textContent).toContain(
        "Which router"
      );
      expect(queryAllDeep(el, ".depends-chip").length).toBe(2);
      expect(queryAllDeep(el, ".decision-text")[0]?.textContent).toContain(
        "Excalibur wins"
      );
      expect(queryAllDeep(el, ".decision-gist")[0]?.textContent).toContain(
        "2 sources"
      );
    } finally {
      restore();
    }
  });

  it("ticket-card renders the live chat while a HITL session runs", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "ticket-card": "/api/.../ticket-card" },
      load(ticketCardModule)
    );
    try {
      const instance = ticketEntry("t-2", "resolving_prototype");
      instance.state.workflowInstanceState = {
        title: "Prototype the sync flow",
        type: "prototype",
        hitl: true,
      };
      instance.state.hasRunningTask = true;
      instance.state.runningTaskContext = {
        role: "ai-chat",
        interactive: true,
        sessionId: "s-1",
        messages: [
          { role: "user", content: "Keep it offline-first" },
          { role: "assistant", content: "Offline-first it is." },
        ],
      };
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [ticketDef()],
          instances: [instance],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));

      const messages = queryAllDeep(el, ".chat-msg");
      expect(messages.length).toBe(2);
      expect(messages[1]?.textContent).toContain("Offline-first it is.");
      expect(queryAllDeep(el, ".hitl-marker").length).toBe(1);
    } finally {
      restore();
    }
  });

  it("build-item-card renders the worker outcome and the reviewer verdict + findings", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "build-item-card": "/api/.../build-item-card" },
      load(buildItemCardModule)
    );
    try {
      const def = cardDef({
        id: "buildItem",
        label: "Build Item",
        states: [
          {
            id: "ready",
            label: "Ready",
            category: "initial",
            actions: [],
            tasks: [],
          },
          {
            id: "working",
            label: "Working",
            category: "active",
            actions: [],
            tasks: [],
          },
          {
            id: "running",
            label: "Running",
            category: "active",
            actions: [],
            tasks: [],
          },
          {
            id: "reviewing",
            label: "Reviewing",
            category: "active",
            actions: [],
            tasks: [],
          },
          {
            id: "accepting",
            label: "Accepting",
            category: "active",
            actions: [],
            tasks: [],
          },
          {
            id: "done",
            label: "Done",
            category: "terminal",
            actions: [],
            tasks: [],
          },
        ],
        ui: { view: "board", instanceComponent: "build-item-card" },
      });
      const item = entry("b-1", "reviewing");
      item.workflowId = "buildItem";
      item.state.workflowInstanceState = {
        ticket: {
          title: "Add the retry loop",
          description: "Retry transient failures up to three times.",
          acceptanceCriteria: ["Exponential backoff", "Bounded retries"],
        },
        branchName: "retry-loop",
        worktreePath: ".build/retry-loop",
      };
      item.state.taskOutputs = {
        runAgent: {
          status: "success",
          output: {
            content: "done",
            completion: {
              outcome: "implemented",
              summary: "Retry loop with backoff, tests green.",
            },
          },
        },
        review: {
          status: "success",
          output: {
            verdict: "changes_requested",
            findings: [
              {
                axis: "spec",
                severity: "major",
                detail: "Backoff caps at 10s, spec says 30s.",
              },
            ],
          },
        },
      };
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [def],
          instances: [item],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));

      expect(queryAllDeep(el, ".outcome-head")[0]?.textContent).toBe(
        "implemented"
      );
      expect(queryAllDeep(el, ".outcome-summary")[0]?.textContent).toContain(
        "backoff"
      );
      expect(queryAllDeep(el, ".review-verdict")[0]?.textContent).toBe(
        "changes_requested"
      );
      expect(queryAllDeep(el, ".review-finding")[0]?.textContent).toContain(
        "Backoff caps"
      );
      expect(queryAllDeep(el, ".branch-line").length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it("expedition-map renders destinations, the fog→frontier→charted trail, and charted progress", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "expedition-map": "/api/.../expedition-map" },
      load(expeditionMapModule)
    );
    try {
      const def = cardDef({
        id: "charting",
        label: "Charting",
        terminalStates: ["charted"],
        states: [
          {
            id: "no_session",
            label: "No Session",
            category: "initial",
            actions: [],
            tasks: [],
          },
          {
            id: "naming",
            label: "Naming",
            category: "active",
            actions: [],
            tasks: [],
          },
          {
            id: "frontier",
            label: "Frontier",
            category: "active",
            actions: [],
            tasks: [],
          },
          {
            id: "charted",
            label: "Charted",
            category: "terminal",
            actions: [],
            tasks: [],
          },
        ],
        ui: { view: "list", workflowComponent: "expedition-map" },
      });
      const chartedEntry = entry("c-1", "charted");
      chartedEntry.workflowId = "charting";
      chartedEntry.state.workflowInstanceState = {
        destination: "hive router",
        notes: "Offline-first; execution carried into the map.",
      };
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [def],
          instances: [chartedEntry],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));

      expect(queryAllDeep(el, ".map-title")[0]?.textContent).toBe(
        "Expedition map"
      );
      expect(queryAllDeep(el, ".map-progress")[0]?.textContent).toContain(
        "1 of 1 charted"
      );
      expect(queryAllDeep(el, ".destination-title")[0]?.textContent).toBe(
        "hive router"
      );
      expect(queryAllDeep(el, ".destination-notes")[0]?.textContent).toContain(
        "Offline-first"
      );
      // The charted destination shows the full trail reached.
      const reached = queryAllDeep(el, ".trail-step[data-reached='true']");
      expect(reached.length).toBe(3);
    } finally {
      restore();
    }
  });

  it("frontier-board composes the canonical board under a fog/frontier summary bar", async () => {
    defineFlowRenderingComponents();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "" }))
    );
    const restore = await loadFlowComponents(
      { "frontier-board": "/api/.../frontier-board" },
      load(frontierBoardModule)
    );
    try {
      const def = cardDef({
        id: "ticket",
        label: "Ticket",
        ui: {
          view: "board",
          workflowComponent: "frontier-board",
          columns: [
            { id: "fog", label: "Fog", states: ["fog"] },
            { id: "frontier", label: "Frontier", states: ["ready"] },
            { id: "closed", label: "Closed", states: ["closed"] },
          ],
        },
      });
      const fog = ticketEntry("t-1", "fog");
      const ready = ticketEntry("t-2", "ready");
      const closed = ticketEntry("t-3", "closed");
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [def],
          instances: [fog, ready, closed],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));

      // The summary bar counts the fog / frontier / closed lanes.
      const chips = queryAllDeep(el, ".summary-chip");
      expect(chips[0]?.textContent).toContain("fog");
      expect(chips[0]?.textContent).toContain("1");
      expect(chips[1]?.textContent).toContain("frontier");
      expect(chips[1]?.textContent).toContain("1");
      expect(chips[3]?.textContent).toContain("closed");
      expect(chips[3]?.textContent).toContain("1");
      // The canonical board composes underneath (via the globally registered
      // <workflow-board-content> element).
      expect(queryAllDeep(el, "workflow-board-content").length).toBe(1);
      expect(queryAllDeep(el, ".flow-board").length).toBe(1);
    } finally {
      restore();
    }
  });
});
