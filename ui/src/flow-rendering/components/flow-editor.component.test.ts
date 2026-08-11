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
  settle,
  shadowRootOf,
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

  it("renders the tokenized code pane from previewSource", async () => {
    const el = await mountEditor();
    const code = shadowRootOf(el).querySelector(".code");
    expect(code).not.toBeNull();
    // The source is tokenized: keywords and strings become spans.
    expect(code?.querySelector(".tok-keyword")?.textContent).toBe("export");
    expect(code?.querySelector(".tok-string")?.textContent).toBe('"demo"');
    expect(code?.textContent).toContain("const flow");
  });

  it("renders draft notes from previewErrors", async () => {
    const el = await mountEditor();
    const notes = shadowRootOf(el).querySelectorAll(".pane-errors li");
    expect(notes.length).toBe(1);
    expect(notes[0]?.textContent).toContain(
      "spec.workflows[0]: state id 'x' is not a valid identifier"
    );
  });

  it("renders no code pane when the draft has neither source nor notes", async () => {
    const el = await mountEditor(
      authoringEntry({
        hasRunningTask: false,
        runningTaskId: null,
        runningTaskContext: null,
        workflowInstanceState: { prompt: "Nothing yet" },
      })
    );
    expect(shadowRootOf(el).querySelector(".code")).toBeNull();
    expect(shadowRootOf(el).querySelector(".pane-errors")).toBeNull();
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
});
