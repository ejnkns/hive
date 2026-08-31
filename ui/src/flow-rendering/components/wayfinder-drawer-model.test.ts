// The wayfinder drawer view model: the selected WorkflowItem's detail — title,
// derived presentation, actual workflow state (with its definition label),
// type, question/brief, blocker and dependent references, the resolution task
// output, the persisted decision record, branch/worktree data, available
// actions, and the live interactive chat context. Tested at the pure seam (a
// named export of the wayfinder-drawer-model module, imported directly as
// TypeScript) rather than through the DOM, so the content decision — what the
// drawer shows for a frontier ticket vs a research run vs a build item — is
// pinned before any drawer markup renders.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import { deriveDrawerDetail } from "../../../../presets/wayfinder/ui/wayfinder-drawer-model.ts";
import {
  deriveWayfinderMap,
  type WayfinderMap,
} from "../../../../presets/wayfinder/ui/wayfinder-map.ts";
import { cardDef, entry } from "../test-fixtures.ts";
import { wayfinderFixtureEntries } from "./wayfinder-fixtures.ts";

// A minimal WorkflowInstanceEntry for a wayfinder instance (the fields the
// drawer model reads are workflowId, currentState, workflowInstanceState,
// taskOutputs, runningTaskContext, and availableActions).
function instance(
  workflowId: string,
  id: string,
  currentState: string,
  instanceState: Record<string, unknown> = {},
  taskOutputs: Partial<WorkflowInstanceEntry["state"]["taskOutputs"]> = {}
): WorkflowInstanceEntry {
  const e = entry(id, currentState, { taskOutputs });
  e.workflowId = workflowId;
  e.state.workflowInstanceState = instanceState;
  return e;
}

function ticket(
  id: string,
  state: string,
  instanceState: Record<string, unknown> = {},
  taskOutputs: Partial<WorkflowInstanceEntry["state"]["taskOutputs"]> = {}
): WorkflowInstanceEntry {
  return instance("ticket", id, state, instanceState, taskOutputs);
}

// A workflow definition carrying wayfinder's state labels, so the drawer's
// "actual workflow state" label assertions are independent literals.
function ticketDef(
  states: ReadonlyArray<[string, string]>
): WorkflowDefResponse {
  return cardDef({
    id: "ticket",
    label: "Ticket",
    states: states.map(([id, label]) => ({
      id,
      label,
      category: "active",
      actions: [],
      tasks: [],
    })),
  });
}

const TICKET_DEF = ticketDef([
  ["fog", "Fog"],
  ["ready", "Ready"],
  ["resolving_research", "Resolving — research"],
  ["resolving_prototype", "Resolving — prototype"],
  ["closed", "Closed"],
  ["out_of_scope", "Out of scope"],
]);

const BUILD_DEF: WorkflowDefResponse = cardDef({
  id: "build",
  label: "Build",
  states: [
    {
      id: "proposed",
      label: "Proposed",
      category: "active",
      actions: [],
      tasks: [],
    },
  ],
});

const BUILD_ITEM_DEF: WorkflowDefResponse = cardDef({
  id: "buildItem",
  label: "Build Item",
  states: [
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
  ],
});

function modelOf(entries: readonly WorkflowInstanceEntry[]): WayfinderMap {
  return deriveWayfinderMap(entries as WorkflowInstanceEntry[]);
}

const EMPTY_DIRS = undefined;

describe("deriveDrawerDetail — selection resolution", () => {
  it("returns undefined when nothing is selected or the id is not a map node", () => {
    const entries = wayfinderFixtureEntries();
    const model = modelOf(entries);
    assert.equal(
      deriveDrawerDetail({
        selectedId: undefined,
        model,
        entries,
        workflowDefs: [TICKET_DEF],
        persistedOutputDirs: EMPTY_DIRS,
      }),
      undefined
    );
    assert.equal(
      deriveDrawerDetail({
        selectedId: "no-such-node",
        model,
        entries,
        workflowDefs: [TICKET_DEF],
        persistedOutputDirs: EMPTY_DIRS,
      }),
      undefined
    );
  });

  it("resolves the node title and the derived presentation status", () => {
    const entries = wayfinderFixtureEntries();
    const model = modelOf(entries);
    const detail = deriveDrawerDetail({
      selectedId: "ticket-frontier",
      model,
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.ok(detail !== undefined);
    assert.equal(detail.title, "Pick the failover policy");
    assert.equal(detail.presentation, "frontier");
    assert.equal(detail.presentationLabel, "Frontier");
  });

  it("reads the actual workflow state and its definition label", () => {
    const entries = wayfinderFixtureEntries();
    const model = modelOf(entries);
    const detail = deriveDrawerDetail({
      selectedId: "ticket-resolving",
      model,
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.ok(detail !== undefined);
    assert.equal(detail.stateId, "resolving_research");
    assert.equal(detail.stateLabel, "Resolving — research");
  });

  it("reads type and question from ticket state, brief for fog tickets", () => {
    const entries = wayfinderFixtureEntries();
    const model = modelOf(entries);
    const frontier = deriveDrawerDetail({
      selectedId: "ticket-frontier",
      model,
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.equal(frontier?.type, "research");
    assert.equal(
      frontier?.question,
      "Circuit-breaker half-open or cooldown-first?"
    );
    const fog = deriveDrawerDetail({
      selectedId: "ticket-fog",
      model,
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.equal(fog?.question, "Do metrics survive the proxy restart?");
    assert.equal(fog?.stateId, "fog");
  });
});

describe("deriveDrawerDetail — blocker and dependent references", () => {
  it("resolves blocker ids to their node titles", () => {
    const entries = wayfinderFixtureEntries();
    const model = modelOf(entries);
    const blocked = deriveDrawerDetail({
      selectedId: "ticket-blocked",
      model,
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.deepEqual(blocked?.blockers, [
      { id: "ticket-fog", title: "Do metrics survive the proxy restart?" },
    ]);
  });

  it("resolves the reverse dependents index for a blocker", () => {
    const entries = wayfinderFixtureEntries();
    const model = modelOf(entries);
    const fog = deriveDrawerDetail({
      selectedId: "ticket-fog",
      model,
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.deepEqual(fog?.dependents, [
      { id: "ticket-blocked", title: "Sketch the retry console" },
    ]);
  });

  it("keeps a dangling blocker reference with its raw id as the title", () => {
    const entries = wayfinderFixtureEntries();
    entries.push(
      ticket("ticket-dangling", "ready", {
        title: "Depends on a ghost",
        type: "task",
        dependsOn: ["ghost-ticket"],
      })
    );
    const model = modelOf(entries);
    const detail = deriveDrawerDetail({
      selectedId: "ticket-dangling",
      model,
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.deepEqual(detail?.blockers, [
      { id: "ghost-ticket", title: "ghost-ticket" },
    ]);
  });
});

describe("deriveDrawerDetail — resolution task output", () => {
  it("reads the research findings and sources off the research task", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      ticket("t-r", "resolving_research", {
        title: "Grill the provider seam",
        question: "Which provider errors are retryable?",
        type: "research",
      }),
    ];
    entries[1].state.taskOutputs = {
      research: {
        status: "success",
        output: {
          question: "Which provider errors are retryable?",
          findings: "# Findings\n\nProviders are flaky.",
          sources: ["https://a.example", "https://b.example"],
        },
      },
    };
    const detail = deriveDrawerDetail({
      selectedId: "t-r",
      model: modelOf(entries),
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.deepEqual(detail?.resolution, [
      {
        kind: "research",
        findings: "# Findings\n\nProviders are flaky.",
        sources: ["https://a.example", "https://b.example"],
      },
    ]);
  });

  it("reads the decision and gist off a chat resolution session", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      ticket("t-p", "resolving_prototype", {
        title: "Sketch the retry console",
        type: "prototype",
      }),
    ];
    entries[1].state.taskOutputs = {
      prototypeSession: {
        status: "success",
        output: {
          completion: {
            decision: "Cooldown-first, bounded retries.",
            gist: "Cooldown first.",
            artifactPath: "prototypes/retry-console",
          },
        },
      },
    };
    const detail = deriveDrawerDetail({
      selectedId: "t-p",
      model: modelOf(entries),
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.deepEqual(detail?.resolution, [
      {
        kind: "decision",
        gist: "Cooldown first.",
        decision: "Cooldown-first, bounded retries.",
        artifactPath: "prototypes/retry-console",
      },
    ]);
  });

  it("reads the build-item worker outcome and the reviewer verdict", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      instance("buildItem", "bi-1", "reviewing", {
        ticket: { title: "Retry loop" },
      }),
    ];
    entries[1].state.taskOutputs = {
      runAgent: {
        status: "success",
        output: {
          completion: { outcome: "implemented", summary: "Retries bounded." },
        },
      },
      review: {
        status: "success",
        output: {
          verdict: "approved",
          findings: [
            {
              axis: "correctness",
              severity: "minor",
              detail: "Edge case",
              evidence: "x.ts:12",
            },
          ],
        },
      },
    };
    const detail = deriveDrawerDetail({
      selectedId: "bi-1",
      model: modelOf(entries),
      entries,
      workflowDefs: [BUILD_ITEM_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.deepEqual(detail?.resolution, [
      {
        kind: "build-outcome",
        outcome: "implemented",
        summary: "Retries bounded.",
      },
      {
        kind: "review",
        verdict: "approved",
        findings: [
          {
            axis: "correctness",
            severity: "minor",
            detail: "Edge case",
            evidence: "x.ts:12",
          },
        ],
      },
    ]);
  });

  it("reads the build plan tickets off the plan task", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      instance("build", "b-1", "proposed", { spec: "# Spec" }),
    ];
    entries[1].state.taskOutputs = {
      plan: {
        status: "success",
        output: {
          tickets: [
            {
              title: "T1",
              description: "Retry the router",
              acceptanceCriteria: ["Retries are bounded"],
              dependsOn: [],
            },
          ],
        },
      },
    };
    const detail = deriveDrawerDetail({
      selectedId: "b-1",
      model: modelOf(entries),
      entries,
      workflowDefs: [BUILD_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.deepEqual(detail?.resolution, [
      {
        kind: "plan",
        tickets: [
          {
            title: "T1",
            description: "Retry the router",
            acceptanceCriteria: ["Retries are bounded"],
            dependsOn: [],
          },
        ],
      },
    ]);
  });

  it("surfaces the resolution error when a resolution task failed", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      ticket("t-r", "resolving_research", {
        title: "Grill the provider seam",
        type: "research",
      }),
    ];
    entries[1].state.taskOutputs = {
      research: {
        status: "error",
        error: "Model call failed",
        output: undefined,
      },
    };
    const detail = deriveDrawerDetail({
      selectedId: "t-r",
      model: modelOf(entries),
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.equal(detail?.resolutionError, "Model call failed");
    assert.deepEqual(detail?.resolution, []);
  });
});

describe("deriveDrawerDetail — decision record and workspace data", () => {
  it("reads the persisted decision record for a closed ticket", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      ticket("t-d", "closed", { title: "Decide the form", type: "research" }),
    ];
    const detail = deriveDrawerDetail({
      selectedId: "t-d",
      model: modelOf(entries),
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: {
        decisions: {
          "t-d.md":
            "# Decision — Decide the form\n\nThe register is central.\n",
        },
      },
    });
    assert.equal(
      detail?.decisionRecord,
      "# Decision — Decide the form\n\nThe register is central.\n"
    );
  });

  it("reads branch and worktree data off the instance state", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      ticket("t-p", "resolving_prototype", {
        title: "Sketch the console",
        type: "prototype",
        branchName: "proto/t-p",
        worktreePath: ".wayfinder/worktrees/t-p",
      }),
    ];
    const detail = deriveDrawerDetail({
      selectedId: "t-p",
      model: modelOf(entries),
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.equal(detail?.branch, "proto/t-p");
    assert.equal(detail?.worktree, ".wayfinder/worktrees/t-p");
  });
});

describe("deriveDrawerDetail — actions and live chat", () => {
  it("carries the instance's available actions", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      ticket("t-f", "ready", { title: "Pick the router", type: "research" }),
    ];
    entries[1].availableActions = [
      { id: "claim_research", label: "Claim for research", variant: "primary" },
    ];
    const detail = deriveDrawerDetail({
      selectedId: "t-f",
      model: modelOf(entries),
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.deepEqual(detail?.actions, [
      { id: "claim_research", label: "Claim for research", variant: "primary" },
    ]);
  });

  it("carries the live interactive chat context", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      ticket("t-p", "resolving_prototype", {
        title: "Sketch the console",
        type: "prototype",
      }),
    ];
    entries[1].state.hasRunningTask = true;
    entries[1].state.runningTaskContext = {
      role: "ai-chat",
      messages: [{ role: "user", content: "go" }],
      sessionId: "session-1",
      interactive: true,
      modelStatus: { stage: "streaming" },
    };
    const detail = deriveDrawerDetail({
      selectedId: "t-p",
      model: modelOf(entries),
      entries,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.deepEqual(detail?.chat, {
      messages: [{ role: "user", content: "go" }],
      sessionId: "session-1",
      interactive: true,
      thinking: true,
      modelStatus: { stage: "streaming" },
    });
  });

  it("omits the chat for a non-interactive (one-shot) session", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      instance("buildItem", "bi-1", "running", {
        ticket: { title: "Retry loop" },
      }),
    ];
    entries[1].state.hasRunningTask = true;
    entries[1].state.runningTaskContext = {
      role: "ai-chat",
      messages: [{ role: "assistant", content: "working" }],
      sessionId: "session-2",
      interactive: false,
    };
    const detail = deriveDrawerDetail({
      selectedId: "bi-1",
      model: modelOf(entries),
      entries,
      workflowDefs: [BUILD_ITEM_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.equal(detail?.chat, undefined);
  });
});

describe("deriveDrawerDetail — graceful degradation", () => {
  it("keeps node-level detail when the entry is missing from the snapshot", () => {
    const full = wayfinderFixtureEntries();
    const model = modelOf(full);
    const withoutEntry = full.filter((e) => e.id !== "ticket-frontier");
    const detail = deriveDrawerDetail({
      selectedId: "ticket-frontier",
      model,
      entries: withoutEntry,
      workflowDefs: [TICKET_DEF],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.ok(detail !== undefined);
    assert.equal(detail.title, "Pick the failover policy");
    // The node carries the actual state even without the entry.
    assert.equal(detail.stateId, "ready");
    assert.equal(detail.stateLabel, "Ready");
    assert.equal(detail.actions.length, 0);
    assert.equal(detail.resolution?.length, 0);
  });

  it("falls back to the raw state id when the definition is unknown", () => {
    const entries = [
      instance("charting", "c-1", "charted", { destination: "hive router" }),
      ticket("t-x", "resolving_task", { title: "Run it", type: "task" }),
    ];
    const detail = deriveDrawerDetail({
      selectedId: "t-x",
      model: modelOf(entries),
      entries,
      workflowDefs: [],
      persistedOutputDirs: EMPTY_DIRS,
    });
    assert.equal(detail?.stateId, "resolving_task");
    assert.equal(detail?.stateLabel, "resolving_task");
  });
});
