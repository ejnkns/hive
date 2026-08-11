import { describe, expect, it, vi } from "vitest";
import type {
  WorkflowDefResponse,
  WorkflowInstanceEntry,
} from "workflow-engine/create-flow-runtime";
import type { ChatMessage } from "workflow-engine/workflow-types";
import {
  click,
  mount,
  queryAllDeep,
  queryDeep,
  settle,
  shadowRootOf,
  type,
} from "../test-utils.ts";
import { FlowEditor } from "./flow-editor.ts";

// Behavior tests for the built-in authoring-session instance component: the
// header (title from the instance's prompt), the running ai-chat, the
// tokenized code pane bound to previewSource/previewErrors, and the action
// row rendered from availableActions.

function authoringDef(): WorkflowDefResponse {
  return {
    id: "session",
    label: "Authoring session",
    instance: { title: "prompt" },
    states: [
      {
        id: "drafting",
        label: "Drafting",
        category: "initial",
        actions: [],
        tasks: [{ id: "assistant", label: "Assistant" }],
      },
    ],
    initial: "drafting",
    terminalStates: [],
  };
}

const MESSAGES: ChatMessage[] = [
  { role: "user", content: "Build a review flow" },
];

function authoringEntry(
  overrides: Partial<WorkflowInstanceEntry["state"]> = {}
): WorkflowInstanceEntry {
  return {
    id: "s1",
    workflowId: "session",
    state: {
      currentState: "drafting",
      hasRunningTask: true,
      runningTaskId: "assistant",
      runningTaskContext: {
        role: "ai-chat",
        messages: MESSAGES,
        sessionId: "ses-1",
        interactive: true,
      },
      taskOutputs: {},
      workflowInstanceState: {
        prompt: "Build a review flow",
        previewSource: 'export const flow = { id: "demo" };',
        previewErrors: [
          "spec.workflows[0]: state id 'x' is not a valid identifier",
        ],
      },
      history: [],
      ...overrides,
    },
    availableActions: [
      { id: "validate", label: "Validate", variant: "secondary" },
      { id: "save", label: "Save definition", variant: "primary" },
    ],
    editFields: [],
    workflowSummary: { total: 0, byField: {} },
  };
}

async function mountEditor(
  instance: WorkflowInstanceEntry = authoringEntry()
): Promise<FlowEditor> {
  const el = await mount(
    Object.assign(new FlowEditor(), {
      workflowDef: authoringDef(),
      instanceEntry: instance,
      customKinds: [],
    })
  );
  await settle(shadowRootOf(el));
  return el;
}

describe("FlowEditor", () => {
  it("renders the session header with the title from the instance prompt", async () => {
    const el = await mountEditor();
    expect(shadowRootOf(el).querySelector(".editor-title")?.textContent).toBe(
      "Build a review flow"
    );
  });

  it("renders the running ai-chat session with its messages", async () => {
    const el = await mountEditor();
    const chat = shadowRootOf(el).querySelector("chat-session");
    expect(chat).not.toBeNull();
    await settle(shadowRootOf(chat as FlowEditor));
    // Message bodies render through markdown-view inside the chat's shadow.
    expect(
      queryAllDeep(chat as FlowEditor, "markdown-view").length
    ).toBeGreaterThan(0);
  });

  it("renders the highlighted code editor bound to source ?? previewSource", async () => {
    const el = await mountEditor();
    const code = queryDeep(el, ".code");
    expect(code).not.toBeNull();
    // The source is tokenized: keywords and strings become spans.
    expect(code?.querySelector(".tok-keyword")?.textContent).toBe("export");
    expect(code?.querySelector(".tok-string")?.textContent).toBe('"demo"');
    expect(code?.textContent).toContain("const flow");
    // The editor is editable — a textarea over the overlay.
    expect(queryDeep(el, "textarea")).not.toBeNull();
  });

  it("renders draft notes from previewErrors", async () => {
    const el = await mountEditor();
    const notes = shadowRootOf(el).querySelectorAll(".pane-errors li");
    expect(notes.length).toBe(1);
    expect(notes[0]?.textContent).toContain(
      "spec.workflows[0]: state id 'x' is not a valid identifier"
    );
  });

  it("renders an editable editor even before any source or draft", async () => {
    const el = await mountEditor(
      authoringEntry({
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: { prompt: "Nothing yet" },
      })
    );
    const textarea = queryDeep(el, "textarea") as HTMLTextAreaElement;
    expect(textarea).toBeDefined();
    expect(textarea.value).toBe("");
    expect(shadowRootOf(el).querySelector(".pane-errors")).toBeNull();
  });

  it("binds the editor to source over previewSource", async () => {
    const el = await mountEditor(
      authoringEntry({
        workflowInstanceState: {
          prompt: "p",
          previewSource: "preview text",
          source: "source text",
        },
      })
    );
    expect((queryDeep(el, "textarea") as HTMLTextAreaElement).value).toBe(
      "source text"
    );
  });

  it("renders the action row from availableActions and forwards clicks", async () => {
    const el = await mountEditor();
    const onAction = vi.fn();
    el.onAction = onAction;
    await el.updateComplete;

    const bar = shadowRootOf(el).querySelector("action-bar");
    expect(bar).not.toBeNull();
    const buttons = [
      ...shadowRootOf(bar as Element).querySelectorAll("button"),
    ];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      "Save definition",
      "Validate",
    ]);

    const save = buttons.find(
      (b) => b.textContent?.trim() === "Save definition"
    );
    save?.dispatchEvent(click());
    await el.updateComplete;
    expect(onAction).toHaveBeenCalledWith("save", undefined);
  });

  it("dispatches hive-action with the instance id when no onAction callback is set", async () => {
    const el = await mountEditor();
    const emitted = new Promise<CustomEvent>((resolve) =>
      el.addEventListener("hive-action", resolve as EventListener, {
        once: true,
      })
    );
    const bar = shadowRootOf(el).querySelector("action-bar") as Element;
    const buttons = [...shadowRootOf(bar).querySelectorAll("button")];
    buttons
      .find((b) => b.textContent?.trim() === "Validate")
      ?.dispatchEvent(click());
    expect((await emitted).detail).toEqual({
      instanceId: "s1",
      actionId: "validate",
    });
  });

  it("renders the Save button in the chat window, disabled until a source exists", async () => {
    const el = await mountEditor(
      authoringEntry({ workflowInstanceState: { prompt: "No source yet" } })
    );
    const button = shadowRootOf(el).querySelector(
      "button.save-btn"
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(true);

    el.instanceEntry = authoringEntry({
      workflowInstanceState: {
        prompt: "Build a flow",
        source: "export const flow = {};",
      },
    });
    await el.updateComplete;
    const enabled = shadowRootOf(el).querySelector(
      "button.save-btn"
    ) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
  });

  it("Save button click emits hive-action with actionId save", async () => {
    const el = await mountEditor();
    el.instanceEntry = authoringEntry({
      workflowInstanceState: {
        prompt: "Build a flow",
        source: "export const flow = {};",
      },
    });
    await el.updateComplete;
    const onAction = vi.fn();
    el.onAction = onAction;

    const button = shadowRootOf(el).querySelector(
      "button.save-btn"
    ) as HTMLButtonElement;
    button.dispatchEvent(click());
    await el.updateComplete;
    expect(onAction).toHaveBeenCalledWith("save", undefined);
  });

  it("renders the saved state and its findings from instance state", async () => {
    const el = await mountEditor(
      authoringEntry({
        workflowInstanceState: {
          prompt: "Build a flow",
          source: "export const flow = {};",
          savedDefinitionId: "review-flow",
          savedName: "Review Flow",
          saveFindings: {
            errors: ["spec.workflows[0]: a gate reads an undeclared field"],
            warnings: ["state 'new' has no way out"],
          },
        },
      })
    );
    const status = shadowRootOf(el).querySelector(".saved-status");
    expect(status?.textContent).toContain("Saved as Review Flow");
    expect(status?.textContent).toContain("review-flow");
    expect(status?.textContent).toContain("1 warning(s)");
    const findings = [
      ...shadowRootOf(el).querySelectorAll(".saved-findings li"),
    ];
    expect(findings.map((f) => f.textContent)).toEqual([
      "spec.workflows[0]: a gate reads an undeclared field",
      "1 warning(s)",
    ]);
  });

  it("writes the human's edits back to the session, throttled", async () => {
    const el = await mountEditor();
    const onPatchState = vi.fn();
    el.onPatchState = onPatchState;
    await el.updateComplete;

    const textarea = queryDeep(el, "textarea") as HTMLTextAreaElement;
    type(textarea, "export const flow = {};");
    await el.updateComplete;
    // Debounced: nothing until the idle window elapses.
    expect(onPatchState).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(onPatchState).toHaveBeenCalledWith({
      source: "export const flow = {};",
    });
  });

  it("keeps the human's typing until the write-back round-trips", async () => {
    const el = await mountEditor();
    el.onPatchState = vi.fn();
    const textarea = () => queryDeep(el, "textarea") as HTMLTextAreaElement;

    type(textarea(), "manual edit");
    await el.updateComplete;

    // A snapshot carrying the OLD source must not clear the typing.
    el.instanceEntry = authoringEntry({
      workflowInstanceState: { prompt: "p", source: "old" },
    });
    await el.updateComplete;
    expect(textarea().value).toBe("manual edit");

    // Once the snapshot carries the typed source (the round-trip), the
    // override clears and future agent changes show through.
    el.instanceEntry = authoringEntry({
      workflowInstanceState: { prompt: "p", source: "manual edit" },
    });
    await el.updateComplete;
    el.instanceEntry = authoringEntry({
      workflowInstanceState: { prompt: "p", source: "agent new" },
    });
    await el.updateComplete;
    expect(textarea().value).toBe("agent new");
  });

  it("shows the diverged note and discard handoff while the source is manual", async () => {
    const el = await mountEditor(
      authoringEntry({
        workflowInstanceState: {
          prompt: "p",
          source: "const a = 1;",
          specDiverged: true,
        },
      })
    );
    expect(shadowRootOf(el).querySelector(".diverged-note")).not.toBeNull();
    const onAction = vi.fn();
    el.onAction = onAction;
    await el.updateComplete;
    const discard = shadowRootOf(el).querySelector(
      "button.discard-btn"
    ) as HTMLButtonElement;
    discard.dispatchEvent(click());
    await el.updateComplete;
    expect(onAction).toHaveBeenCalledWith("discard", undefined);
  });
});
