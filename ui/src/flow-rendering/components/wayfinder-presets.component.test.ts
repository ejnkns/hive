// The wayfinder served modules (W3), mounted through the fake evaluator
// pattern: the real preset component modules are evaluated against the app's
// lit runtime and registered, then asserted through the workflow-instances
// surface. These are behavior tests over the actual shipped components.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstanceEntry } from "workflow-engine/create-flow-runtime";
import type {
  FlowActionView,
  FlowComponentDeps,
  FlowComponentRegistrations,
} from "workflow-engine/workflow-types";
import buildItemCardModule from "../../../../presets/wayfinder/ui/build-item-card.ts";
import flowComponentModule from "../../../../presets/wayfinder/ui/flow-component.ts";
import ticketCardModule from "../../../../presets/wayfinder/ui/ticket-card.ts";
import { defineFlowRenderingComponents } from "../define-components.ts";
import type { FlowComponentEvaluator } from "../load-flow-components.ts";
import { loadFlowComponents } from "../load-flow-components.ts";
import { cardDef, entry } from "../test-fixtures.ts";
import {
  click,
  mount,
  mustFind,
  mustQuery,
  queryAllDeep,
  settle,
  shadowRootOf,
  type,
} from "../test-utils.ts";
import {
  WAYFINDER_DECISION_RECORDS,
  wayfinderFixtureEntries,
} from "./wayfinder-fixtures.ts";
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

// Mounts a fresh host (a new WorkflowInstances element) for the
// flow-component class registered by mountFlowComponent — the remount half of
// the view-state tests, simulating a class swap or page reload within the
// same session.
async function mountFlowComponentHost(
  instances: WorkflowInstanceEntry[],
  options: {
    flowId?: string;
    config?: Record<string, unknown>;
    persistedOutputDirs?: Record<string, Record<string, string>>;
    persistedOutputs?: Record<string, string>;
    availableFlowActions?: FlowActionView[];
    revision?: number;
  } = {}
) {
  const flowId = options.flowId ?? "flow-1";
  const config = options.config ?? {};
  const charting = cardDef({ id: "charting", label: "Charting" });
  const ticket = cardDef({ id: "ticket", label: "Ticket" });
  const build = cardDef({ id: "build", label: "Build" });
  const buildItem = cardDef({ id: "buildItem", label: "Build Item" });
  const el = await mount(
    Object.assign(new WorkflowInstances(), {
      flowId,
      flow: {
        id: flowId,
        label: "Wayfinder",
        status: "idle",
        config,
        revision: options.revision,
      },
      flowComponent: "flow-component",
      workflowDefs: [charting, ticket, build, buildItem],
      instances,
      customKinds: [],
      availableFlowActions: options.availableFlowActions ?? [],
      persistedOutputs: options.persistedOutputs ?? {},
      persistedOutputDirs: options.persistedOutputDirs ?? {},
    })
  );
  await settle(shadowRootOf(el));
  return el;
}

// Mounts the served flow-component through the fake evaluator with charting +
// ticket definitions and the given instances; returns the settled host and the
// module-registry restore the caller must run in a finally.
async function mountFlowComponent(
  instances: WorkflowInstanceEntry[],
  options: {
    config?: Record<string, unknown>;
    persistedOutputDirs?: Record<string, Record<string, string>>;
    persistedOutputs?: Record<string, string>;
    availableFlowActions?: FlowActionView[];
    revision?: number;
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
  const el = await mountFlowComponentHost(instances, options);
  return { el, restore };
}

// Drags the second fog card (t-3) above the first (t-2) in the rendered host:
// jsdom rects are all zeros, so per-card geometry is stubbed (first spans y
// 0..40, second y 40..80) to make the insertion deterministic.
async function dragSecondFogFirst(el: WorkflowInstances): Promise<void> {
  const firstCard = queryAllDeep(el, '.fog-card[data-id="t-2"]')[0];
  const secondCard = queryAllDeep(el, '.fog-card[data-id="t-3"]')[0];
  const pile = firstCard?.parentElement;
  expect(firstCard).toBeDefined();
  expect(secondCard).toBeDefined();
  expect(pile).toBeDefined();
  vi.spyOn(firstCard, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 0, 40)
  );
  vi.spyOn(secondCard, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 40, 0, 40)
  );
  secondCard?.dispatchEvent(
    new MouseEvent("dragstart", { bubbles: true, composed: true })
  );
  pile?.dispatchEvent(
    new MouseEvent("dragover", { bubbles: true, composed: true })
  );
  pile?.dispatchEvent(
    new MouseEvent("drop", { bubbles: true, composed: true, clientY: 10 })
  );
  pile?.dispatchEvent(
    new MouseEvent("dragend", { bubbles: true, composed: true })
  );
  await settle(shadowRootOf(el));
  vi.restoreAllMocks();
}

function mouseEnter(): MouseEvent {
  return new MouseEvent("mouseenter", { bubbles: true, composed: true });
}

function mouseLeave(): MouseEvent {
  return new MouseEvent("mouseleave", { bubbles: true, composed: true });
}

describe("wayfinder served modules", () => {
  // jsdom cannot provide a Canvas 2d context; the map surface guards the
  // null context (drawing is verified in a real browser). Stub getContext
  // with a plain assignment (not a vi spy — some tests call restoreAllMocks
  // mid-test) so the jsdom warning stays out of the suite output.
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof originalGetContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

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

  it("ticket-card marks an out-of-scope ticket as ruled out, distinct from a decision", async () => {
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
      const instance = ticketEntry("t-1", "out_of_scope");
      instance.state.workflowInstanceState = {
        title: "Rewrite the renderer",
        type: "task",
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

      // out_of_scope is a distinct terminal: ruled out, not a recorded
      // decision — the card says so instead of rendering a decision pane.
      const marker = queryAllDeep(el, ".scope-marker");
      expect(marker.length).toBe(1);
      expect(marker[0]?.textContent).toContain("ruled out");
      expect(queryAllDeep(el, ".decision").length).toBe(0);
    } finally {
      restore();
    }
  });

  it("ticket-card renders a ready ticket with unsatisfied dependencies as waiting on them", async () => {
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
      const instance = ticketEntry("t-1", "ready");
      instance.state.workflowInstanceState = {
        title: "Pick the routing layer",
        type: "research",
        dependsOn: ["t-2", "t-3"],
      };
      // The engine-projected fact (ticket 12): t-2 resolved, t-3 not.
      instance.dependencies = {
        blockers: ["t-2", "t-3"],
        unsatisfied: ["t-3"],
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

      // The card names the waiting state in text (not colour alone) and
      // names the unresolved dependencies.
      const note = mustFind(el, ".waiting-note");
      expect(note.textContent).toContain("Waiting on");
      expect(note.textContent).toContain("t-3");
      expect(note.textContent).not.toContain("t-2");
      // The unresolved chip is marked, the satisfied one is not.
      const chips = queryAllDeep(el, ".depends-chip");
      expect(chips.length).toBe(2);
      const unsatisfied = chips.filter((chip) =>
        chip.hasAttribute("data-unsatisfied")
      );
      expect(unsatisfied.map((chip) => chip.textContent)).toEqual(["t-3"]);
    } finally {
      restore();
    }
  });

  it("ticket-card does not render the waiting note on a frontier-ready ticket", async () => {
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
      const instance = ticketEntry("t-1", "ready");
      instance.state.workflowInstanceState = {
        title: "Pick the routing layer",
        type: "research",
        dependsOn: ["t-2"],
      };
      // The engine projected every blocker as satisfied — the ticket is the
      // actionable frontier and must not present as waiting.
      instance.dependencies = { blockers: ["t-2"], unsatisfied: [] };
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [ticketDef()],
          instances: [instance],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));

      expect(queryAllDeep(el, ".waiting-note").length).toBe(0);
      expect(queryAllDeep(el, ".depends-chip").length).toBe(1);
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

      const messages = queryAllDeep(el, ".msg");
      expect(messages.length).toBe(2);
      // Both message bodies render as markdown inside nested shadows.
      const markdowns = queryAllDeep(el, "markdown-view");
      expect(markdowns.length).toBe(2);
      expect(markdowns[1]?.shadowRoot?.textContent).toContain(
        "Offline-first it is."
      );
      // The shared chat-session component (the authoring chat) renders the
      // transcript with a session header naming the running phase, and an
      // interactive input.
      expect(queryAllDeep(el, ".session-label").length).toBe(1);
      expect(
        queryAllDeep(el, "input[placeholder='Type a message...']").length
      ).toBe(1);
      expect(queryAllDeep(el, ".hitl-marker").length).toBe(1);
    } finally {
      restore();
    }
  });

  it("ticket-card does not show the thinking indicator for a session waiting for its first user input", async () => {
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
      // A freshly claimed grilling ticket: the session runs but the transcript
      // is only the system prompt — the agent is waiting for the human's first
      // message, not thinking. The card must invite input, not claim the agent
      // is composing a reply.
      const instance = ticketEntry("t-2", "resolving_grilling");
      instance.state.workflowInstanceState = {
        title: "Grill the auth model",
        question: "Which auth flow?",
        type: "grilling",
      };
      instance.state.hasRunningTask = true;
      instance.state.runningTaskContext = {
        role: "ai-chat",
        interactive: true,
        sessionId: "s-1",
        messages: [
          {
            role: "system",
            content:
              "You are grilling one decision ticket to resolution. The question is provided by the human.",
          },
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

      expect(queryAllDeep(el, ".thinking").length).toBe(0);
      // The interactive input is still offered — the human starts the session.
      expect(
        queryAllDeep(el, "input[placeholder='Type a message...']").length
      ).toBe(1);
    } finally {
      restore();
    }
  });

  it("ticket-card surfaces a failed resolution session with the error and the retry action", async () => {
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
      // The grilling session errored (a mid-stream failure that exhausted the
      // retries): the card must explain why the session stopped and offer the
      // retry action instead of leaving the user staring at a stale state.
      const instance = ticketEntry("t-2", "resolving_grilling");
      instance.state.workflowInstanceState = {
        title: "Grill the auth model",
        question: "Which auth flow?",
        type: "grilling",
      };
      instance.state.taskOutputs = {
        grillSession: {
          status: "error",
          error: "read ECONNRESET",
          output: undefined,
        },
      };
      instance.availableActions = [
        { id: "retry", label: "Retry grilling", variant: "secondary" },
      ];
      const el = await mount(
        Object.assign(new WorkflowInstances(), {
          flowId: "flow-1",
          workflowDefs: [ticketDef()],
          instances: [instance],
          customKinds: [],
        })
      );
      await settle(shadowRootOf(el));

      const error = queryAllDeep(el, ".session-error")[0];
      expect(error?.textContent).toContain("read ECONNRESET");
      expect(queryAllDeep(el, ".thinking").length).toBe(0);
      const buttons = queryAllDeep(el, ".ticket-actions button").map((button) =>
        button.textContent?.trim()
      );
      expect(buttons).toContain("Retry grilling");
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
  // --- Ticket 05: the map-first shell and HUD ---

  // Clicks the Map/Table toggle inside whichever shell is rendered.
  async function switchView(el: WorkflowInstances, view: "map" | "table") {
    const buttons = queryAllDeep(el, ".view-toggle button");
    const target = buttons.find(
      (button) => button.textContent?.trim().toLowerCase() === view
    );
    expect(target, `the ${view} toggle is visible`).toBeDefined();
    (target as HTMLElement).click();
    await settle(shadowRootOf(el));
  }

  const addTicketAction: FlowActionView = {
    id: "add_ticket",
    label: "Add ticket",
    variant: "primary",
    createInstance: { workflowId: "ticket", fields: [] },
  };

  it("flow-component renders the map-first shell with a HUD: identity, destination, derived counts, progress, legend, actions, and map controls", async () => {
    const { el, restore } = await mountFlowComponent(
      wayfinderFixtureEntries(),
      { availableFlowActions: [addTicketAction] }
    );
    try {
      // A populated expedition defaults to the map, not the table.
      expect(queryAllDeep(el, ".map-layout").length).toBe(1);
      expect(queryAllDeep(el, ".table").length).toBe(0);

      // The HUD names the expedition and its destination.
      const hud = queryAllDeep(el, ".hud")[0];
      expect(hud).toBeDefined();
      expect(queryAllDeep(el, ".hud .title")[0]?.textContent).toBe("Wayfinder");
      expect(queryAllDeep(el, ".hud .dest")[0]?.textContent).toBe(
        "Hive router resilience"
      );

      // The counts come from the shared presentation model — the frontier
      // chip counts the blockers-closed frontier, never every `ready` ticket.
      // The fixture has TWO ready tickets: one with all blockers closed
      // (frontier) and one blocked on an open fog ticket.
      expect(queryAllDeep(el, ".chip.frontier")[0]?.textContent).toBe(
        "1 frontier"
      );
      expect(queryAllDeep(el, ".chip.blocked")[0]?.textContent).toBe(
        "1 blocked"
      );
      expect(queryAllDeep(el, ".chip.active")[0]?.textContent).toBe("1 active");
      expect(queryAllDeep(el, ".chip.decision")[0]?.textContent).toBe(
        "1 decision"
      );
      expect(queryAllDeep(el, ".chip.fog")[0]?.textContent).toBe("1 fog");
      expect(queryAllDeep(el, ".chip.out-of-scope")[0]?.textContent).toBe(
        "1 out of scope"
      );
      expect(queryAllDeep(el, ".chip.implementation")[0]?.textContent).toBe(
        "2 implementation"
      );

      // Progress: 1 decision of the 5-step journey (fog + frontier + blocked
      // + active + decision) is 20% charted; out-of-scope and implementation
      // are not journey steps.
      const progress = queryAllDeep(el, ".hud-progress")[0];
      expect(progress?.getAttribute("role")).toBe("progressbar");
      expect(progress?.getAttribute("aria-valuenow")).toBe("20");
      expect(queryAllDeep(el, ".progress-label")[0]?.textContent).toBe(
        "20% charted"
      );

      // The legend labels the journey statuses with text (colour is never the
      // only signal).
      const legend = queryAllDeep(el, ".legend-item").map((item) =>
        item.textContent?.trim()
      );
      expect(legend).toEqual(["frontier", "blocked", "active", "decision"]);

      // Flow actions are data-driven through availableFlowActions/onCreate.
      expect(
        queryAllDeep(el, ".hud-actions button")[0]?.textContent?.trim()
      ).toBe("Add ticket");

      // The HUD carries the map controls (Fit/Reset) and the Map/Table toggle.
      expect(queryAllDeep(el, ".hud-map-controls button.fit").length).toBe(1);
      expect(queryAllDeep(el, ".hud-map-controls button.reset").length).toBe(1);
      const toggle = queryAllDeep(el, ".view-toggle button").map((button) =>
        button.textContent?.trim()
      );
      expect(toggle).toEqual(["Map", "Table"]);
    } finally {
      restore();
    }
  });

  it("flow-component renders the Base Camp empty state for a newly created flow", async () => {
    const chartingEntry = entry("c-1", "naming");
    chartingEntry.workflowId = "charting";
    chartingEntry.state.workflowInstanceState = {
      destination: "Hive router resilience",
    };
    chartingEntry.availableActions = [
      { id: "start_charting", label: "Start charting", variant: "primary" },
    ];
    const { el, restore } = await mountFlowComponent([chartingEntry]);
    try {
      // No map, no table: the empty expedition presents the Base Camp.
      expect(queryAllDeep(el, ".base-panel").length).toBe(1);
      expect(queryAllDeep(el, ".map-layout").length).toBe(0);
      expect(queryAllDeep(el, ".table").length).toBe(0);
      expect(queryAllDeep(el, ".hud").length).toBe(0);

      // The camp names the flow, its destination, and the charting session
      // card with its action — the journey starts here.
      expect(queryAllDeep(el, ".header .title")[0]?.textContent).toBe(
        "Wayfinder"
      );
      expect(queryAllDeep(el, ".base-dest .name")[0]?.textContent).toBe(
        "Hive router resilience"
      );
      expect(queryAllDeep(el, ".station-head")[0]?.textContent).toBe(
        "Base camp"
      );
      expect(queryAllDeep(el, ".card .lbl")[0]?.textContent).toBe("naming");
      expect(queryAllDeep(el, ".card .card-title")[0]?.textContent).toBe(
        "Hive router resilience"
      );
      expect(
        queryAllDeep(el, ".card-actions button")[0]?.textContent?.trim()
      ).toBe("Start charting");
      expect(queryAllDeep(el, ".base-hint")[0]?.textContent).toContain(
        "chart the frontier"
      );

      // The Map/Table toggle stays visible from the start: the table is a
      // useful workbench even while the expedition is empty, and the sparse
      // map degrades back to the Base Camp.
      const toggle = queryAllDeep(el, ".view-toggle button").map((button) =>
        button.textContent?.trim()
      );
      expect(toggle).toEqual(["Map", "Table"]);
      await switchView(el, "table");
      expect(queryAllDeep(el, ".table").length).toBe(1);
      expect(queryAllDeep(el, ".base-panel").length).toBe(0);
      await switchView(el, "map");
      expect(queryAllDeep(el, ".base-panel").length).toBe(1);
    } finally {
      restore();
    }
  });

  it("flow-component Base Camp names uncharted territory before the destination is settled", async () => {
    // A freshly created flow has no destination yet: the camp must not render
    // an empty breadcrumb — it names the territory uncharted instead.
    const chartingEntry = entry("c-1", "naming");
    chartingEntry.workflowId = "charting";
    chartingEntry.state.workflowInstanceState = { destination: "" };
    const { el, restore } = await mountFlowComponent([chartingEntry]);
    try {
      expect(queryAllDeep(el, ".base-dest .name")[0]?.textContent).toBe(
        "Uncharted territory"
      );
    } finally {
      restore();
    }
  });

  it("flow-component applies the expeditionTheme and switches map and table via the toggle", async () => {
    const { el, restore } = await mountFlowComponent(
      wayfinderFixtureEntries(),
      { config: { expeditionTheme: "stars" } }
    );
    try {
      // The config's expeditionTheme selects the stars skin on the chrome
      // wrapper and on the map surface host.
      expect(
        queryAllDeep(el, ".expedition")[0]?.getAttribute("data-theme")
      ).toBe("stars");
      const surface = queryAllDeep(el, ".map-surface")[0];
      const viewHost = (surface?.getRootNode() as ShadowRoot).host;
      expect(viewHost.getAttribute("data-theme")).toBe("stars");

      // Map-first: the surface with its panel is primary.
      expect(queryAllDeep(el, ".map-layout").length).toBe(1);
      expect(queryAllDeep(el, ".panel").length).toBe(1);

      // The toggle switches to the table...
      await switchView(el, "table");
      expect(queryAllDeep(el, ".map-layout").length).toBe(0);
      expect(queryAllDeep(el, ".table").length).toBe(1);
      expect(
        queryAllDeep(el, ".expedition")[0]?.getAttribute("data-theme")
      ).toBe("stars");

      // ...and back to the map.
      await switchView(el, "map");
      expect(queryAllDeep(el, ".map-layout").length).toBe(1);
      expect(queryAllDeep(el, ".table").length).toBe(0);
    } finally {
      restore();
    }
  });

  it("flow-component renders the alternate table: stations, journal, depot, do-not-enter, and the mini-map", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = {
      destination: "hive router",
      notes: "offline-first",
    };
    const readyTicket = entry("t-1", "ready");
    readyTicket.workflowId = "ticket";
    readyTicket.state.workflowInstanceState = {
      title: "Pick the router",
      type: "research",
    };
    readyTicket.availableActions = [
      { id: "claim_research", label: "Claim for research", variant: "primary" },
    ];
    const fogTicket = entry("t-2", "fog");
    fogTicket.workflowId = "ticket";
    fogTicket.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const closedTicket = entry("t-3", "closed");
    closedTicket.workflowId = "ticket";
    closedTicket.state.workflowInstanceState = {
      title: "Pilot is concurrency-first",
      type: "research",
    };
    const outOfScopeTicket = entry("t-4", "out_of_scope");
    outOfScopeTicket.workflowId = "ticket";
    outOfScopeTicket.state.workflowInstanceState = {
      title: "Carve-out audit",
      type: "task",
    };
    const buildEntry = entry("b-1", "accepted");
    buildEntry.workflowId = "build";
    const itemEntry = entry("bi-1", "done");
    itemEntry.workflowId = "buildItem";
    itemEntry.state.workflowInstanceState = { ticket: { title: "Retry loop" } };

    const { el, restore } = await mountFlowComponent(
      [
        charted,
        readyTicket,
        fogTicket,
        closedTicket,
        outOfScopeTicket,
        buildEntry,
        itemEntry,
      ],
      {
        availableFlowActions: [addTicketAction],
        persistedOutputs: {
          "spec.md": "# Retry loop\nRetry transient failures.",
          "build-plan.md": "# Plan\nThree build items.",
        },
      }
    );
    try {
      // Map-first default; the toggle opens the table.
      await switchView(el, "table");

      // Header: expedition identity + flow actions + the toggle.
      expect(queryAllDeep(el, ".title")[0]?.textContent).toBe("Wayfinder");
      const actionLabels = queryAllDeep(el, ".actions button").map((button) =>
        button.textContent?.trim()
      );
      expect(actionLabels).toContain("Add ticket");
      expect(
        queryAllDeep(el, ".expedition")[0]?.getAttribute("data-theme")
      ).toBe("mountain");

      // All stations are present (base camp, briefing, fog, on expedition,
      // journal, depot, do-not-enter).
      const heads = queryAllDeep(el, ".station-head").map(
        (head) => head.textContent ?? ""
      );
      expect(heads).toContain("Base camp");
      expect(heads).toContain("The briefing deck");
      expect(heads).toContain("The fog tray");
      expect(heads).toContain("On expedition");
      expect(heads).toContain("The journal");
      expect(heads).toContain("The supply depot");
      expect(heads).toContain("Do not enter");

      // Briefing deck: the ready ticket with a type stamp and a claim button.
      expect(queryAllDeep(el, ".stamp")[0]?.textContent).toBe("research");
      expect(
        queryAllDeep(el, ".card-actions button")[0]?.textContent?.trim()
      ).toBe("Claim for research");
      // Fog tray: highlighted, always visible, never blurred.
      expect(queryAllDeep(el, ".fog-card").length).toBe(1);
      expect(queryAllDeep(el, ".fog-card .tag")[0]?.textContent).toBe(
        "needs clarity"
      );
      // Journal + do-not-enter keep decisions and ruled-out tickets separate.
      expect(queryAllDeep(el, ".journal .entry").length).toBe(1);
      expect(queryAllDeep(el, ".journal .txt")[0]?.textContent).toBe(
        "Pilot is concurrency-first"
      );
      // Depot: spec, plan, build, and build-item crates.
      expect(queryAllDeep(el, ".crate").length).toBeGreaterThanOrEqual(3);
      // The mini-map card carries the destination and an SVG mini-map, and
      // its button opens the full map view.
      expect(queryAllDeep(el, ".dest-note .name")[0]?.textContent).toBe(
        "hive router"
      );
      expect(queryAllDeep(el, ".map-card svg").length).toBe(1);
      expect(queryAllDeep(el, ".open-map").length).toBe(1);
    } finally {
      restore();
    }
  });

  it("flow-component syncs hover between map nodes and sidebar entries, with keyboard focus mirroring", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const fogTicket = ticketEntry("t-2", "fog");
    fogTicket.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const { el, restore } = await mountFlowComponent([charted, fogTicket]);
    try {
      // Map-first: no drill-in needed, the surface is already primary.
      const node = queryAllDeep(el, '.map-surface .node[data-id="t-2"]')[0];
      const entryRow = queryAllDeep(el, '.panel .entry[data-id="t-2"]')[0];
      expect(node).toBeDefined();
      expect(entryRow).toBeDefined();

      // Node -> entry: hovering the map node lights its sidebar entry.
      node?.dispatchEvent(mouseEnter());
      await settle(shadowRootOf(el));
      expect(node?.classList.contains("hl")).toBe(true);
      expect(entryRow?.classList.contains("hl")).toBe(true);
      node?.dispatchEvent(mouseLeave());
      await settle(shadowRootOf(el));
      expect(node?.classList.contains("hl")).toBe(false);
      expect(entryRow?.classList.contains("hl")).toBe(false);

      // Entry -> node: hovering the sidebar entry lights its map node.
      entryRow?.dispatchEvent(mouseEnter());
      await settle(shadowRootOf(el));
      expect(node?.classList.contains("hl")).toBe(true);
      expect(entryRow?.classList.contains("hl")).toBe(true);
      entryRow?.dispatchEvent(mouseLeave());
      await settle(shadowRootOf(el));
      expect(node?.classList.contains("hl")).toBe(false);

      // Keyboard focus mirrors hover through the tabindex + focus/blur pair.
      entryRow?.dispatchEvent(new FocusEvent("focus"));
      await settle(shadowRootOf(el));
      expect(node?.classList.contains("hl")).toBe(true);
      entryRow?.dispatchEvent(new FocusEvent("blur"));
      await settle(shadowRootOf(el));
      expect(node?.classList.contains("hl")).toBe(false);
    } finally {
      restore();
    }
  });

  it("flow-component does not show the table chat's thinking indicator for a session waiting for its first user input", async () => {
    // A freshly opened naming session: the transcript is only the system
    // prompt — the agent is waiting for the human's first message, not
    // composing a reply. The card must invite input, not claim the agent is
    // thinking (the same contract the ticket card pins).
    const naming = entry("charting-1", "naming");
    naming.workflowId = "charting";
    naming.state.workflowInstanceState = { destination: "" };
    naming.state.hasRunningTask = true;
    naming.state.runningTaskContext = {
      role: "ai-chat",
      interactive: true,
      sessionId: "s-1",
      messages: [
        {
          role: "system",
          content: "You are naming one expedition destination.",
        },
      ],
    };
    const fogTicket = ticketEntry("t-1", "fog");
    const { el, restore } = await mountFlowComponent([naming, fogTicket]);
    try {
      await switchView(el, "table");
      expect(queryAllDeep(el, ".card-chat").length).toBe(1);
      expect(queryAllDeep(el, ".thinking").length).toBe(0);
      // The interactive input is still offered — the human starts the session.
      expect(
        queryAllDeep(el, "input[placeholder='Type a message...']").length
      ).toBe(1);
    } finally {
      restore();
    }
  });

  it("flow-component presents blocked-ready tickets as blocked in the briefing deck via the shared presentation status", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      await switchView(el, "table");
      // The frontier dossier (every dependsOn blocker closed) keeps its plain
      // type stamp — the deck's claimable paper.
      const frontier = queryAllDeep(el, '.card[data-id="ticket-frontier"]')[0];
      expect(frontier).toBeDefined();
      expect(frontier?.querySelector(".stamp")?.textContent).toBe("research");
      // A ready ticket with an unresolved dependsOn blocker is domain-ready
      // but not claimable: the deck reads the shared presentation model and
      // presents it as blocked — never a second domain status field.
      const blocked = queryAllDeep(el, '.card[data-id="ticket-blocked"]')[0];
      expect(blocked).toBeDefined();
      const blockedStamp = blocked?.querySelector(".stamp")?.textContent ?? "";
      expect(blockedStamp).toContain("blocked");
      expect(blockedStamp).toContain("prototype");
    } finally {
      restore();
    }
  });

  it("flow-component syncs hover between table cards and mini-map markers, both directions", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const fogTicket = ticketEntry("t-2", "fog");
    fogTicket.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const { el, restore } = await mountFlowComponent([charted, fogTicket]);
    try {
      await switchView(el, "table");
      const fogCard = queryAllDeep(el, ".fog-card")[0];
      const marker = queryAllDeep(el, '.marker[data-id="t-2"]')[0];
      expect(fogCard?.getAttribute("data-id")).toBe("t-2");
      expect(marker).toBeDefined();

      // Card -> marker: hovering the fog card lights its marker up.
      fogCard?.dispatchEvent(mouseEnter());
      await settle(shadowRootOf(el));
      expect(fogCard?.classList.contains("hl")).toBe(true);
      expect(marker?.classList.contains("hl")).toBe(true);
      fogCard?.dispatchEvent(mouseLeave());
      await settle(shadowRootOf(el));
      expect(fogCard?.classList.contains("hl")).toBe(false);
      expect(marker?.classList.contains("hl")).toBe(false);

      // Marker -> card: hovering the marker lights its card up.
      marker?.dispatchEvent(mouseEnter());
      await settle(shadowRootOf(el));
      expect(fogCard?.classList.contains("hl")).toBe(true);
      expect(marker?.classList.contains("hl")).toBe(true);
      marker?.dispatchEvent(mouseLeave());
      await settle(shadowRootOf(el));
      expect(fogCard?.classList.contains("hl")).toBe(false);
      expect(marker?.classList.contains("hl")).toBe(false);
    } finally {
      restore();
    }
  });

  it("flow-component pulses a clicked card into focus and auto-clears it", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const fogTicket = ticketEntry("t-2", "fog");
    fogTicket.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const { el, restore } = await mountFlowComponent([charted, fogTicket]);
    try {
      await switchView(el, "table");
      const fogCard = queryAllDeep(el, ".fog-card")[0];
      const marker = queryAllDeep(el, '.marker[data-id="t-2"]')[0];
      vi.useFakeTimers();
      try {
        fogCard?.dispatchEvent(click());
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        expect(fogCard?.classList.contains("focus")).toBe(true);
        expect(fogCard?.classList.contains("hl")).toBe(true);
        expect(marker?.classList.contains("focus")).toBe(true);
        // The focus state clears itself without any further interaction.
        await vi.advanceTimersByTimeAsync(2_100);
        await Promise.resolve();
        expect(fogCard?.classList.contains("focus")).toBe(false);
        expect(fogCard?.classList.contains("hl")).toBe(false);
        expect(marker?.classList.contains("focus")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    } finally {
      restore();
    }
  });

  it("flow-component shows live agent status and the last error on the resolving card", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const running = ticketEntry("t-1", "resolving_research");
    running.state.workflowInstanceState = {
      title: "Pick the router",
      type: "research",
    };
    running.state.hasRunningTask = true;
    running.state.runningTaskContext = {
      role: "ai-task",
      messages: [],
      modelStatus: {
        stage: "dispatched",
        provider: "groq",
        model: "gpt-oss-120b",
      },
    };
    const failed = ticketEntry("t-2", "resolving_research");
    failed.state.workflowInstanceState = {
      title: "Pick the store",
      type: "research",
    };
    failed.state.taskOutputs = {
      research: {
        status: "error",
        error: "Model call failed",
        output: undefined,
      },
    };
    const { el, restore } = await mountFlowComponent([
      charted,
      running,
      failed,
    ]);
    try {
      await switchView(el, "table");
      // The running research card names the dispatched node.
      const statuses = queryAllDeep(el, ".task-status");
      expect(statuses[0]?.textContent).toContain("groq");
      expect(statuses[0]?.textContent).toContain("gpt-oss-120b");
      // The failed research card surfaces the agent error next to the retry.
      const errors = queryAllDeep(el, ".task-error");
      expect(errors[0]?.textContent).toBe("Model call failed");
      expect(queryAllDeep(el, ".task-status").length).toBe(1);
      expect(queryAllDeep(el, ".task-error").length).toBe(1);
    } finally {
      restore();
    }
  });

  it("flow-component reorders fog cards by drag into a session-local clear order", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const first = ticketEntry("t-2", "fog");
    first.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const second = ticketEntry("t-3", "fog");
    second.state.workflowInstanceState = { brief: "reorder the map?" };
    const { el, restore } = await mountFlowComponent([charted, first, second]);
    try {
      await switchView(el, "table");
      const firstCard = queryAllDeep(el, '.fog-card[data-id="t-2"]')[0];
      const secondCard = queryAllDeep(el, '.fog-card[data-id="t-3"]')[0];
      const pile = firstCard?.parentElement;
      expect(firstCard).toBeDefined();
      expect(secondCard).toBeDefined();
      expect(pile).toBeDefined();

      // jsdom rects are all zeros, so stub per-card geometry (first spans y
      // 0..40, second y 40..80) to make the insertion deterministic.
      vi.spyOn(firstCard, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 0, 40)
      );
      vi.spyOn(secondCard, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 40, 0, 40)
      );
      try {
        secondCard?.dispatchEvent(
          new MouseEvent("dragstart", { bubbles: true, composed: true })
        );
        expect(secondCard?.classList.contains("dragging")).toBe(true);

        pile?.dispatchEvent(
          new MouseEvent("dragover", { bubbles: true, composed: true })
        );
        // Dropping just above the first card's middle reorders second first.
        pile?.dispatchEvent(
          new MouseEvent("drop", {
            bubbles: true,
            composed: true,
            clientY: 10,
          })
        );
        pile?.dispatchEvent(
          new MouseEvent("dragend", { bubbles: true, composed: true })
        );
        await settle(shadowRootOf(el));

        const order = queryAllDeep(el, ".fog-card").map((card) =>
          card.getAttribute("data-id")
        );
        expect(order).toEqual(["t-3", "t-2"]);
      } finally {
        vi.restoreAllMocks();
      }
    } finally {
      restore();
    }
  });

  it("flow-component defaults to the map-first view, theme, and fog order when no view state is stored", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const first = ticketEntry("t-2", "fog");
    first.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const second = ticketEntry("t-3", "fog");
    second.state.workflowInstanceState = { brief: "reorder the map?" };
    const { el, restore } = await mountFlowComponent([charted, first, second]);
    try {
      // No stored view: a populated expedition presents the map first.
      expect(queryAllDeep(el, ".map-layout").length).toBe(1);
      expect(queryAllDeep(el, ".table").length).toBe(0);
      expect(
        queryAllDeep(el, ".expedition")[0]?.getAttribute("data-theme")
      ).toBe("mountain");

      // The table still holds the natural fog order.
      await switchView(el, "table");
      const order = queryAllDeep(el, ".fog-card").map((card) =>
        card.getAttribute("data-id")
      );
      expect(order).toEqual(["t-2", "t-3"]);
    } finally {
      restore();
    }
  });

  it("flow-component persists the view mode and restores it on a fresh mount", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const fogTicket = ticketEntry("t-2", "fog");
    fogTicket.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const { el, restore } = await mountFlowComponent([charted, fogTicket]);
    try {
      // Switch to the table: the choice persists session-scoped.
      await switchView(el, "table");
      expect(queryAllDeep(el, ".table").length).toBe(1);
      expect(sessionStorage.getItem("hive:view:flow-1:view")).toBe("table");

      // A fresh mount within the same session restores the table.
      el.remove();
      const remounted = await mountFlowComponentHost([charted, fogTicket]);
      expect(queryAllDeep(remounted, ".table").length).toBe(1);
      expect(queryAllDeep(remounted, ".map-layout").length).toBe(0);
    } finally {
      restore();
    }
  });

  it("flow-component restores the legacy map-open storage key gracefully", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const fogTicket = ticketEntry("t-2", "fog");
    fogTicket.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const { el, restore } = await mountFlowComponent([charted, fogTicket]);
    try {
      // A session that wrote the pre-view-mode map-open flag ("0" = table)
      // still restores the table, even though map is the new default.
      sessionStorage.setItem("hive:view:flow-1:map-open", "0");
      el.remove();
      const remounted = await mountFlowComponentHost([charted, fogTicket]);
      expect(queryAllDeep(remounted, ".table").length).toBe(1);

      // The new view key wins over the legacy flag when both exist.
      sessionStorage.setItem("hive:view:flow-1:view", "map");
      sessionStorage.setItem("hive:view:flow-1:map-open", "0");
      remounted.remove();
      const again = await mountFlowComponentHost([charted, fogTicket]);
      expect(queryAllDeep(again, ".map-layout").length).toBe(1);

      // A stored table view applies even to an empty expedition: the stations
      // are a workbench, so the choice is not silently ignored.
      const chartingOnly = entry("c-1", "naming");
      chartingOnly.workflowId = "charting";
      chartingOnly.state.workflowInstanceState = { destination: "" };
      sessionStorage.setItem("hive:view:flow-1:view", "table");
      again.remove();
      const emptyTable = await mountFlowComponentHost([chartingOnly]);
      expect(queryAllDeep(emptyTable, ".table").length).toBe(1);
      expect(queryAllDeep(emptyTable, ".base-panel").length).toBe(0);
    } finally {
      restore();
    }
  });

  it("flow-component view state is flow-scoped: one flow's state never leaks into another", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const first = ticketEntry("t-2", "fog");
    first.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const second = ticketEntry("t-3", "fog");
    second.state.workflowInstanceState = { brief: "reorder the map?" };
    const { el, restore } = await mountFlowComponent([charted, first, second]);
    try {
      // flow-1: switch to the table and reorder the fog tray.
      await switchView(el, "table");
      await dragSecondFogFirst(el);
      expect(sessionStorage.getItem("hive:view:flow-1:view")).toBe("table");
      expect(sessionStorage.getItem("hive:view:flow-1:fog-order")).toBe(
        '["t-3","t-2"]'
      );

      // A different flow mounts with its own defaults: map-first and the
      // natural fog order — nothing leaks over.
      el.remove();
      const other = await mountFlowComponentHost([charted, first, second], {
        flowId: "flow-2",
      });
      expect(queryAllDeep(other, ".map-layout").length).toBe(1);
      expect(queryAllDeep(other, ".table").length).toBe(0);
      expect(
        queryAllDeep(other, ".expedition")[0]?.getAttribute("data-theme")
      ).toBe("mountain");
      await switchView(other, "table");
      const otherOrder = queryAllDeep(other, ".fog-card").map((card) =>
        card.getAttribute("data-id")
      );
      expect(otherOrder).toEqual(["t-2", "t-3"]);

      // flow-1 still restores its own state on a fresh mount.
      other.remove();
      const again = await mountFlowComponentHost([charted, first, second]);
      expect(queryAllDeep(again, ".table").length).toBe(1);
      const againOrder = queryAllDeep(again, ".fog-card").map((card) =>
        card.getAttribute("data-id")
      );
      expect(againOrder).toEqual(["t-3", "t-2"]);
    } finally {
      restore();
    }
  });

  it("flow-component journal drills into a closed ticket's persisted decision record", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const closed = ticketEntry("t-9", "closed");
    closed.state.workflowInstanceState = { title: "Decide the form" };
    const { el, restore } = await mountFlowComponent([charted, closed], {
      persistedOutputDirs: {
        decisions: {
          "t-9.md":
            "# Decision — Decide the form\n\n## Decision\nThe register is central.\n",
        },
      },
    });
    try {
      await switchView(el, "table");
      const journalEntry = queryAllDeep(
        el,
        '.journal .entry[data-id="t-9"]'
      )[0] as HTMLElement | undefined;
      expect(
        journalEntry,
        "the closed ticket sits in the journal"
      ).toBeDefined();

      // Closed by default: the record stays hidden until the entry is opened.
      expect(queryAllDeep(el, ".journal .decision").length).toBe(0);

      // Click opens the record as markdown under the entry.
      journalEntry?.click();
      await settle(shadowRootOf(el));
      const markdowns = queryAllDeep(el, ".journal .decision markdown-view");
      expect(markdowns.length).toBe(1);
      expect(markdowns[0]?.shadowRoot?.textContent).toContain(
        "The register is central."
      );
      expect(markdowns[0]?.shadowRoot?.textContent).toContain(
        "Decide the form"
      );

      // Clicking the open entry collapses it again.
      journalEntry?.click();
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".journal .decision").length).toBe(0);

      // Keyboard parity: Enter on the focused entry reopens the record.
      journalEntry?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".journal .decision markdown-view").length).toBe(
        1
      );
    } finally {
      restore();
    }
  });

  it("flow-component journal degrades when a closed ticket has no decision record", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const closed = ticketEntry("t-9", "closed");
    closed.state.workflowInstanceState = { title: "No record here" };
    const { el, restore } = await mountFlowComponent([charted, closed]);
    try {
      await switchView(el, "table");
      const journalEntry = queryAllDeep(
        el,
        '.journal .entry[data-id="t-9"]'
      )[0] as HTMLElement | undefined;
      journalEntry?.click();
      await settle(shadowRootOf(el));
      expect(
        queryAllDeep(el, ".journal .decision-empty")[0]?.textContent
      ).toContain("No decision record persisted.");
      // No markdown pane for a missing record.
      expect(queryAllDeep(el, ".journal .decision markdown-view").length).toBe(
        0
      );
    } finally {
      restore();
    }
  });

  it("flow-component mounts the persistent map surface with theme, controls, and camera-positioned overlays", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const fogTicket = ticketEntry("t-2", "fog");
    fogTicket.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const { el, restore } = await mountFlowComponent([charted, fogTicket], {
      config: { expeditionTheme: "stars" },
    });
    try {
      // The map-first surface: canvas visual layer + DOM node overlays + panel.
      const surface = queryAllDeep(el, ".map-surface")[0];
      expect(surface).toBeDefined();
      expect(queryAllDeep(el, ".map-surface canvas").length).toBe(1);
      expect(queryAllDeep(el, ".map-surface .node").length).toBeGreaterThan(0);
      // The theme rides the config onto the surface host (its shadow styles
      // key off data-theme), and the HUD's Fit/Reset controls are present.
      const viewHost = (surface?.getRootNode() as ShadowRoot).host;
      expect(viewHost.getAttribute("data-theme")).toBe("stars");
      expect(queryAllDeep(el, ".hud-map-controls button.fit").length).toBe(1);
      expect(queryAllDeep(el, ".hud-map-controls button.reset").length).toBe(1);

      // The controller positioned every overlay through the camera: each node
      // carries a projected screen position in CSS variables.
      for (const node of queryAllDeep(el, ".map-surface .node")) {
        expect(
          (node as HTMLElement).style.getPropertyValue("--node-x")
        ).toMatch(/px$/);
      }

      // The HUD Fit button drives the same controller without throwing.
      const fit = queryAllDeep(el, ".hud-map-controls button.fit")[0] as
        | HTMLElement
        | undefined;
      expect(() => fit?.click()).not.toThrow();
    } finally {
      restore();
    }
  });

  it("flow-component keeps one map surface instance across renders and reopens it after closing", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const fogTicket = ticketEntry("t-2", "fog");
    fogTicket.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const { el, restore } = await mountFlowComponent([charted, fogTicket]);
    try {
      const surface = queryAllDeep(el, ".map-surface")[0];
      const viewHost = (surface?.getRootNode() as ShadowRoot).host;
      const before = viewHost;

      // A hover sync re-renders the entry — the same surface instance stays.
      const node = queryAllDeep(el, '.map-surface .node[data-id="t-2"]')[0];
      node?.dispatchEvent(mouseEnter());
      await settle(shadowRootOf(el));
      expect((surface?.getRootNode() as ShadowRoot).host).toBe(before);

      // Switching to the table detaches (disposes) the surface; switching
      // back re-attaches the same instance — one camera/animation owner for
      // the whole session.
      await switchView(el, "table");
      expect(queryAllDeep(el, ".map-surface").length).toBe(0);
      await switchView(el, "map");
      expect(queryAllDeep(el, ".map-surface").length).toBe(1);
      const reopened = queryAllDeep(el, ".map-surface")[0];
      expect((reopened?.getRootNode() as ShadowRoot).host).toBe(before);
    } finally {
      restore();
    }
  });

  // --- Ticket 06: the in-context WorkflowItem detail drawer ---

  // Engages a map node (or a sidebar panel entry) with a click — the same
  // affordance a real pointer tap goes through (the surface's @click handler).
  function selectNode(el: WorkflowInstances, id: string, inPanel = false) {
    const selector = inPanel
      ? `.panel .entry[data-id="${id}"]`
      : `.map-surface .node[data-id="${id}"]`;
    const target = queryAllDeep(el, selector)[0];
    expect(target, `the ${selector} element is present`).toBeDefined();
    (target as HTMLElement).dispatchEvent(click());
  }

  it("selecting a map node opens the in-context detail drawer while the map stays visible", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      expect(queryAllDeep(el, ".drawer").length).toBe(0);
      selectNode(el, "ticket-frontier");
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer").length).toBe(1);
      expect(queryAllDeep(el, ".drawer-name")[0]?.textContent).toBe(
        "Pick the failover policy"
      );
      // The map surface stays in the DOM — the drawer is in context, not a
      // navigation.
      expect(queryAllDeep(el, ".map-surface").length).toBe(1);
    } finally {
      restore();
    }
  });

  it("selecting a sidebar entry opens the same drawer", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      selectNode(el, "ticket-fog", true);
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer-name")[0]?.textContent).toBe(
        "Do metrics survive the proxy restart?"
      );
    } finally {
      restore();
    }
  });

  it("the drawer shows derived status, actual workflow state, type, and question", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      selectNode(el, "ticket-frontier");
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".status-chip")[0]?.textContent?.trim()).toBe(
        "Frontier"
      );
      expect(queryAllDeep(el, ".state-label")[0]?.textContent).toBe("Ready");
      expect(queryAllDeep(el, ".type-label")[0]?.textContent).toBe("research");
      expect(queryAllDeep(el, ".drawer-question")[0]?.textContent).toBe(
        "Circuit-breaker half-open or cooldown-first?"
      );
    } finally {
      restore();
    }
  });

  it("the drawer renders the resolution task output and the persisted decision record", async () => {
    const entries = wayfinderFixtureEntries();
    const resolving = entries.find((e) => e.id === "ticket-resolving");
    if (resolving !== undefined) {
      resolving.state.taskOutputs = {
        research: {
          status: "success",
          output: {
            question: "Which provider errors are retryable?",
            findings: "# Findings\n\nProviders are flaky.",
            sources: ["https://a.example"],
          },
        },
      };
    }
    const { el, restore } = await mountFlowComponent(entries, {
      persistedOutputDirs: WAYFINDER_DECISION_RECORDS,
    });
    try {
      // The active research ticket shows its findings as markdown.
      selectNode(el, "ticket-resolving");
      await settle(shadowRootOf(el));
      const findings = queryAllDeep(el, ".resolution-block markdown-view")[0];
      expect(findings).toBeDefined();
      expect(findings?.shadowRoot?.textContent).toContain(
        "Providers are flaky."
      );
      expect(queryAllDeep(el, ".resolution-meta")[0]?.textContent).toBe(
        "1 sources"
      );

      // The closed ticket drills into its persisted decision record.
      selectNode(el, "ticket-decision");
      await settle(shadowRootOf(el));
      const titles = queryAllDeep(el, ".drawer-section-title").map((title) =>
        title.textContent?.trim()
      );
      expect(titles).toContain("Decision record");
      const record = queryAllDeep(el, "markdown-view")[0];
      expect(record?.shadowRoot?.textContent).toContain(
        "Pilots run concurrently"
      );
    } finally {
      restore();
    }
  });

  it("drawer actions route through the generic hive-action seam", async () => {
    const entries = wayfinderFixtureEntries();
    const frontier = entries.find((e) => e.id === "ticket-frontier");
    if (frontier !== undefined) {
      frontier.availableActions = [
        {
          id: "claim_research",
          label: "Claim for research",
          variant: "primary",
        },
      ];
    }
    const { el, restore } = await mountFlowComponent(entries);
    try {
      const actions: Array<{ instanceId: string; actionId: string }> = [];
      el.addEventListener("hive-action", (event) => {
        actions.push((event as CustomEvent).detail);
      });
      selectNode(el, "ticket-frontier");
      await settle(shadowRootOf(el));
      const claim = queryAllDeep(el, ".drawer-actions button")[0] as
        | HTMLElement
        | undefined;
      expect(claim?.textContent?.trim()).toBe("Claim for research");
      claim?.dispatchEvent(click());
      await settle(shadowRootOf(el));
      expect(actions[0]).toMatchObject({
        flowId: "flow-1",
        instanceId: "ticket-frontier",
        actionId: "claim_research",
      });
    } finally {
      restore();
    }
  });

  it("the drawer surfaces the live chat session and routes messages through hive-send-message", async () => {
    const entries = wayfinderFixtureEntries();
    const resolving = entries.find((e) => e.id === "ticket-resolving");
    if (resolving !== undefined) {
      resolving.state.currentState = "resolving_prototype";
      resolving.state.hasRunningTask = true;
      resolving.state.runningTaskContext = {
        role: "ai-chat",
        messages: [{ role: "assistant", content: "How should we fail?" }],
        sessionId: "session-1",
        interactive: true,
      };
    }
    const { el, restore } = await mountFlowComponent(entries);
    try {
      const messages: Array<{ instanceId: string; content: string }> = [];
      el.addEventListener("hive-send-message", (event) => {
        messages.push((event as CustomEvent).detail);
      });
      selectNode(el, "ticket-resolving");
      await settle(shadowRootOf(el));
      const session = queryAllDeep(el, "chat-session")[0];
      expect(session).toBeDefined();
      const input = mustQuery(
        shadowRootOf(session),
        "input"
      ) as HTMLInputElement;
      type(input, "cooldown first");
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      await settle(shadowRootOf(el));
      expect(messages[0]).toMatchObject({
        flowId: "flow-1",
        instanceId: "ticket-resolving",
        content: "cooldown first",
      });
    } finally {
      restore();
    }
  });

  it("blocker chips navigate the drawer to the referenced node without leaving the map", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      selectNode(el, "ticket-blocked");
      await settle(shadowRootOf(el));
      const titles = queryAllDeep(el, ".drawer-section-title").map((title) =>
        title.textContent?.trim()
      );
      expect(titles).toContain("Blocks on");
      const chip = queryAllDeep(el, '.ref-chip[data-id="ticket-fog"]')[0] as
        | HTMLElement
        | undefined;
      expect(chip).toBeDefined();
      chip?.dispatchEvent(click());
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer-name")[0]?.textContent).toBe(
        "Do metrics survive the proxy restart?"
      );
      expect(queryAllDeep(el, ".status-chip")[0]?.textContent?.trim()).toBe(
        "Fog"
      );
      // The map stays; the navigated node is durably selected (highlighted).
      expect(queryAllDeep(el, ".map-surface").length).toBe(1);
      expect(
        queryAllDeep(
          el,
          '.map-surface .node[data-id="ticket-fog"]'
        )[0]?.classList.contains("selected")
      ).toBe(true);
    } finally {
      restore();
    }
  });

  it("dependent chips navigate the drawer to the dependent node", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      selectNode(el, "ticket-fog");
      await settle(shadowRootOf(el));
      const titles = queryAllDeep(el, ".drawer-section-title").map((title) =>
        title.textContent?.trim()
      );
      expect(titles).toContain("Dependents");
      const chip = queryAllDeep(el, '.ref-chip[data-id="ticket-blocked"]')[0] as
        | HTMLElement
        | undefined;
      expect(chip).toBeDefined();
      chip?.dispatchEvent(click());
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer-name")[0]?.textContent).toBe(
        "Sketch the retry console"
      );
    } finally {
      restore();
    }
  });

  it("the drawer renders the recorded map document on the summit anchor", async () => {
    const { el, restore } = await mountFlowComponent(
      wayfinderFixtureEntries(),
      {
        persistedOutputs: {
          "map.md":
            "# Wayfinder Map\n\n## Destination\nHive router resilience\n\n## Notes\noffline-first, provider failover\n",
        },
      }
    );
    try {
      selectNode(el, "summit");
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer-name")[0]?.textContent).toBe(
        "Hive router resilience"
      );
      // The chart's content renders verbatim as markdown — never parsed
      // into a second status model.
      const sections = queryAllDeep(el, ".drawer-section-title").map((title) =>
        title.textContent?.trim()
      );
      expect(sections).toContain("Map document");
      expect(sections).toContain("Standing notes");
      const document = queryAllDeep(el, ".drawer-body markdown-view")[0];
      expect(document?.shadowRoot?.textContent).toContain("Wayfinder Map");
      expect(document?.shadowRoot?.textContent).toContain(
        "offline-first, provider failover"
      );
    } finally {
      restore();
    }
  });

  it("the summit drawer degrades gracefully before settle_chart has persisted the map", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      selectNode(el, "summit");
      await settle(shadowRootOf(el));
      // The anchor owns the map document, so the section renders with its
      // empty state — no markdown pane, no broken section.
      expect(queryAllDeep(el, ".map-document-empty")[0]?.textContent).toContain(
        "No map recorded yet"
      );
      expect(queryAllDeep(el, ".drawer-body markdown-view").length).toBe(0);
    } finally {
      restore();
    }
  });

  it("Escape, the close button, and a blank-map tap dismiss the drawer", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      selectNode(el, "ticket-fog");
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer").length).toBe(1);

      // Escape works from anywhere while the drawer is attached.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer").length).toBe(0);

      // The close button.
      selectNode(el, "ticket-fog");
      await settle(shadowRootOf(el));
      (
        queryAllDeep(el, ".drawer-close")[0] as HTMLElement | undefined
      )?.dispatchEvent(click());
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer").length).toBe(0);

      // A blank-map tap (the pointer lands on no node) dismisses too.
      selectNode(el, "ticket-fog");
      await settle(shadowRootOf(el));
      const surface = queryAllDeep(el, ".map-surface")[0];
      surface?.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 790,
          clientY: 590,
          pointerId: 1,
          bubbles: true,
        })
      );
      surface?.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: 790,
          clientY: 590,
          pointerId: 1,
          bubbles: true,
        })
      );
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer").length).toBe(0);
    } finally {
      restore();
    }
  });

  it("Base Camp shows the submit_map destination and notes immediately from a live snapshot", async () => {
    // A fresh expedition mid-naming: no destination recorded yet.
    const naming = entry("charting-1", "naming");
    naming.workflowId = "charting";
    naming.state.workflowInstanceState = { destination: "" };
    const { el, restore } = await mountFlowComponent([naming]);
    try {
      expect(queryAllDeep(el, ".base-dest .name")[0]?.textContent).toBe(
        "Uncharted territory"
      );
      expect(queryAllDeep(el, ".card-notes").length).toBe(0);

      // The agent calls submit_map mid-session; the next coalesced snapshot
      // patches the charting instance state. The Base Camp must show the
      // destination and standing notes on that frame — no remount, no
      // terminal state, no waiting for the next task.
      const recorded = entry("charting-1", "naming");
      recorded.workflowId = "charting";
      recorded.state.workflowInstanceState = {
        destination: "Hive router resilience",
        notes: "offline-first, provider failover",
      };
      el.instances = [recorded];
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".base-dest .name")[0]?.textContent).toBe(
        "Hive router resilience"
      );
      expect(queryAllDeep(el, ".card-notes")[0]?.textContent).toBe(
        "offline-first, provider failover"
      );
    } finally {
      restore();
    }
  });

  it("the HUD destination and summit label follow a live submit_map snapshot", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = {
      destination: "old drifting name",
    };
    const fogTicket = ticketEntry("t-2", "fog");
    fogTicket.state.workflowInstanceState = { brief: "metrics to Effect?" };
    const { el, restore } = await mountFlowComponent([charted, fogTicket]);
    try {
      expect(queryAllDeep(el, ".hud .dest")[0]?.textContent).toBe(
        "old drifting name"
      );
      expect(
        queryAllDeep(el, '.map-surface .node[data-id="summit"] .cap')[0]
          ?.textContent
      ).toBe("old drifting name");

      // The submit_map patch arrives as a new snapshot: the HUD destination
      // and the summit node label re-derive from the same model.
      const recorded = entry("c-1", "charted");
      recorded.workflowId = "charting";
      recorded.state.workflowInstanceState = {
        destination: "Hive router resilience",
        notes: "offline-first",
      };
      el.instances = [recorded, fogTicket];
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".hud .dest")[0]?.textContent).toBe(
        "Hive router resilience"
      );
      expect(
        queryAllDeep(el, '.map-surface .node[data-id="summit"] .cap')[0]
          ?.textContent
      ).toBe("Hive router resilience");
    } finally {
      restore();
    }
  });

  it("the drawer closes when the selected WorkflowItem disappears from a later snapshot", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      selectNode(el, "ticket-fog");
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer").length).toBe(1);

      // A later snapshot without the selected fog ticket: the drawer closes
      // gracefully instead of holding a ghost selection.
      el.instances = wayfinderFixtureEntries().filter(
        (e) => e.id !== "ticket-fog"
      );
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer").length).toBe(0);
      expect(
        queryAllDeep(el, '.map-surface .node[data-id="ticket-fog"]').length
      ).toBe(0);
    } finally {
      restore();
    }
  });

  it("keyboard parity: Enter on a focused node opens the drawer", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      const node = queryAllDeep(
        el,
        '.map-surface .node[data-id="ticket-fog"]'
      )[0];
      node?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer").length).toBe(1);
      expect(queryAllDeep(el, ".drawer-name")[0]?.textContent).toBe(
        "Do metrics survive the proxy restart?"
      );
    } finally {
      restore();
    }
  });

  it("the drawer is a bottom sheet on a narrow viewport and a right-side panel on desktop", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({
          matches: true,
          media: "(max-width: 900px)",
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }))
      );
      try {
        selectNode(el, "ticket-fog");
        await settle(shadowRootOf(el));
        const drawerRoot = queryAllDeep(el, ".drawer")[0];
        expect(drawerRoot).toBeDefined();
        const drawerHost = (drawerRoot?.getRootNode() as ShadowRoot).host;
        // The bottom-sheet face is keyed off the matchMedia-driven attribute.
        expect(drawerHost.hasAttribute("data-compact")).toBe(true);
      } finally {
        vi.unstubAllGlobals();
      }

      // Desktop (matchMedia no longer matches): the same drawer renders as
      // the right-side panel.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await settle(shadowRootOf(el));
      selectNode(el, "ticket-fog");
      await settle(shadowRootOf(el));
      const drawerRoot = queryAllDeep(el, ".drawer")[0];
      const drawerHost = (drawerRoot?.getRootNode() as ShadowRoot).host;
      expect(drawerHost.hasAttribute("data-compact")).toBe(false);
    } finally {
      restore();
    }
  });

  it("the selected node keeps a persistent highlight distinct from the hover pulse", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      selectNode(el, "ticket-fog");
      await settle(shadowRootOf(el));
      const node = queryAllDeep(
        el,
        '.map-surface .node[data-id="ticket-fog"]'
      )[0];
      expect(node?.classList.contains("selected")).toBe(true);

      // Hovering a different node does not steal the durable selection.
      const other = queryAllDeep(
        el,
        '.map-surface .node[data-id="ticket-frontier"]'
      )[0];
      other?.dispatchEvent(mouseEnter());
      await settle(shadowRootOf(el));
      expect(node?.classList.contains("selected")).toBe(true);
      expect(other?.classList.contains("selected")).toBe(false);

      // The sidebar entry carries the same durable selection.
      expect(
        queryAllDeep(
          el,
          '.panel .entry[data-id="ticket-fog"]'
        )[0]?.classList.contains("selected")
      ).toBe(true);
    } finally {
      restore();
    }
  });

  // --- Ticket 07: live-update stability and motion ---

  // Reads a map node overlay's camera-projected screen position (the CSS
  // variables the controller writes) — the observable "where is this node
  // on screen" seam in jsdom.
  function overlayPosition(el: WorkflowInstances, id: string) {
    const node = queryAllDeep(el, `.map-surface .node[data-id="${id}"]`)[0] as
      | HTMLElement
      | undefined;
    expect(node, `the map node overlay for ${id} is present`).toBeDefined();
    return {
      x: node?.style.getPropertyValue("--node-x"),
      y: node?.style.getPropertyValue("--node-y"),
    };
  }

  // The baseline fixture with the frontier ticket advanced to an active
  // (resolving) state — a realistic live snapshot diff.
  function entriesWithFrontierActivated(): WorkflowInstanceEntry[] {
    const later = wayfinderFixtureEntries();
    const frontier = later.find((entry) => entry.id === "ticket-frontier");
    if (frontier !== undefined) {
      frontier.state.currentState = "resolving_research";
    }
    return later;
  }

  it("a live snapshot keeps every existing node overlay in place and animates the new node in", async () => {
    const charted = entry("c-1", "charted");
    charted.workflowId = "charting";
    charted.state.workflowInstanceState = { destination: "hive router" };
    const closed = ticketEntry("t-a", "closed");
    closed.state.workflowInstanceState = { title: "Root decision" };
    const { el, restore } = await mountFlowComponent([charted, closed]);
    try {
      await settle(shadowRootOf(el));
      const rootBefore = overlayPosition(el, "t-a");
      expect(rootBefore.x).toMatch(/px$/);

      // A later snapshot adds one ready dependent of the closed decision.
      const dependent = ticketEntry("t-new", "ready");
      dependent.state.workflowInstanceState = {
        title: "Next step",
        dependsOn: ["t-a"],
      };
      el.instances = [charted, closed, dependent];
      await settle(shadowRootOf(el));

      // The survivor did not move by a single projected screen pixel.
      expect(overlayPosition(el, "t-a")).toEqual(rootBefore);
      // The new node is positioned by the same camera and carries the
      // one-shot entrance mark; the survivor carries no marks.
      expect(overlayPosition(el, "t-new").x).toMatch(/px$/);
      const addedNode = queryAllDeep(
        el,
        '.map-surface .node[data-id="t-new"]'
      )[0];
      expect(addedNode?.classList.contains("enter")).toBe(true);
      expect(addedNode?.classList.contains("flare")).toBe(false);
      const rootNode = queryAllDeep(el, '.map-surface .node[data-id="t-a"]')[0];
      expect(rootNode?.classList.contains("enter")).toBe(false);
      expect(rootNode?.classList.contains("flare")).toBe(false);
    } finally {
      restore();
    }
  });

  it("a presentation status change flares its node and recomputes the HUD counts", async () => {
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".hud .chip.frontier").length).toBe(1);

      el.instances = entriesWithFrontierActivated();
      await settle(shadowRootOf(el));

      // The node flares once (no entrance mark) and its derived status
      // class followed the snapshot (frontier -> active).
      const node = queryAllDeep(
        el,
        '.map-surface .node[data-id="ticket-frontier"]'
      )[0];
      expect(node?.classList.contains("flare")).toBe(true);
      expect(node?.classList.contains("enter")).toBe(false);
      expect(node?.className).toContain("active");
      // The HUD recomputed its counts from the latest snapshot: the
      // frontier chip emptied, the active chip picked the ticket up.
      expect(queryAllDeep(el, ".hud .chip.frontier").length).toBe(0);
      expect(queryAllDeep(el, ".hud .chip.active").length).toBe(1);
    } finally {
      restore();
    }
  });

  it("a changed revision stamp diffs exactly as today", async () => {
    const { el, restore } = await mountFlowComponent(
      wayfinderFixtureEntries(),
      {
        revision: 1,
      }
    );
    try {
      await settle(shadowRootOf(el));

      // The next stamped snapshot: the frontier ticket activated and a new
      // dependent arrived — the host ships a higher revision stamp.
      const later = entriesWithFrontierActivated();
      const dependent = ticketEntry("t-new-stamped", "ready");
      dependent.state.workflowInstanceState = {
        title: "Stamped next step",
        dependsOn: ["t-a"],
      };
      later.push(dependent);
      el.flow = {
        id: "flow-1",
        label: "Wayfinder",
        status: "idle",
        config: {},
        revision: 2,
      };
      el.instances = later;
      await settle(shadowRootOf(el));

      // The changed stamp diffs: the presentation change flares its node...
      const changedNode = queryAllDeep(
        el,
        '.map-surface .node[data-id="ticket-frontier"]'
      )[0];
      expect(changedNode?.classList.contains("flare")).toBe(true);
      // ...and the added node carries the entrance mark while survivors do
      // not — exactly the ticket-07 behaviour, now stamped.
      const addedNode = queryAllDeep(
        el,
        '.map-surface .node[data-id="t-new-stamped"]'
      )[0];
      expect(addedNode?.classList.contains("enter")).toBe(true);
      expect(changedNode?.classList.contains("enter")).toBe(false);
    } finally {
      restore();
    }
  });

  it("an unchanged revision stamp skips the transitions diff: a re-shipped identical snapshot re-triggers no marks", async () => {
    const { el, restore } = await mountFlowComponent(
      wayfinderFixtureEntries(),
      {
        revision: 7,
      }
    );
    try {
      await settle(shadowRootOf(el));
      const enteredIds = queryAllDeep(el, ".map-surface .node.enter")
        .map((node) => node.getAttribute("data-id"))
        .sort();
      expect(enteredIds.length).toBeGreaterThan(0);

      // Content-neutral re-delivery: the host re-ships the identical
      // snapshot content under the same stamp (a coalesced re-render, a
      // reconnect replay). The map skips its live-update diff — no flare
      // appears anywhere and the entrance wave is not recomputed.
      el.flow = {
        id: "flow-1",
        label: "Wayfinder",
        status: "idle",
        config: {},
        revision: 7,
      };
      el.instances = wayfinderFixtureEntries();
      await settle(shadowRootOf(el));

      expect(queryAllDeep(el, ".map-surface .node.flare").length).toBe(0);
      expect(
        queryAllDeep(el, ".map-surface .node.enter")
          .map((node) => node.getAttribute("data-id"))
          .sort()
      ).toEqual(enteredIds);
    } finally {
      restore();
    }
  });

  it("reduced motion suppresses the entrance and flare marks entirely", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "",
        addEventListener() {},
        removeEventListener() {},
      }))
    );
    const { el, restore } = await mountFlowComponent(wayfinderFixtureEntries());
    try {
      await settle(shadowRootOf(el));
      // No entrance wave on the first snapshot...
      expect(queryAllDeep(el, ".map-surface .node.enter").length).toBe(0);

      el.instances = entriesWithFrontierActivated();
      await settle(shadowRootOf(el));
      // ...and no flare on the status change. The derived status class and
      // the HUD counts still follow the snapshot.
      expect(queryAllDeep(el, ".map-surface .node.flare").length).toBe(0);
      expect(
        queryAllDeep(el, '.map-surface .node[data-id="ticket-frontier"]')[0]
          ?.className
      ).toContain("active");
    } finally {
      restore();
      vi.unstubAllGlobals();
    }
  });

  it("the drawer stays open on its selection and refreshes from a later snapshot", async () => {
    // While the ticket resolves, a Done action is offered; the later
    // snapshot advances the same WorkflowItem to closed with no actions —
    // the known manual-testing case (a stale Done staying clickable).
    const baseline = wayfinderFixtureEntries();
    const resolving = baseline.find((entry) => entry.id === "ticket-resolving");
    if (resolving !== undefined) {
      resolving.availableActions = [
        { id: "done", label: "Done", variant: "primary" },
      ];
    }
    const { el, restore } = await mountFlowComponent(baseline);
    try {
      selectNode(el, "ticket-resolving");
      await settle(shadowRootOf(el));
      expect(queryAllDeep(el, ".drawer").length).toBe(1);
      expect(queryAllDeep(el, ".drawer-actions button").length).toBe(1);
      const node = queryAllDeep(
        el,
        '.map-surface .node[data-id="ticket-resolving"]'
      )[0];
      expect(node?.classList.contains("selected")).toBe(true);

      const later = wayfinderFixtureEntries();
      const advanced = later.find((entry) => entry.id === "ticket-resolving");
      if (advanced !== undefined) {
        advanced.state.currentState = "closed";
        advanced.availableActions = [];
      }
      el.instances = later;
      await settle(shadowRootOf(el));

      // The drawer stayed open on the still-existing node, followed the
      // snapshot's presentation, and the stale action disappeared.
      expect(queryAllDeep(el, ".drawer").length).toBe(1);
      expect(queryAllDeep(el, ".drawer-name")[0]?.textContent).toBe(
        "Grill the provider seam"
      );
      expect(queryAllDeep(el, ".status-chip")[0]?.textContent?.trim()).toBe(
        "Decision"
      );
      expect(queryAllDeep(el, ".drawer-actions button").length).toBe(0);
      expect(node?.classList.contains("selected")).toBe(true);
    } finally {
      restore();
    }
  });
});
