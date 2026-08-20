// The flow editor as a rendered flow instantiation, end to end: a lucky-mode
// authoring session renders as a flow instance (the built-in flow-editor
// composing header, chat, editable definition module, and save), and the
// one-artifact co-editing loop works — hand edits write back (the edit IS the
// state), the agent reads the current source and builds on it without
// overwriting, and a regenerate takes the definition back. One session, a
// bounded set of scripted model calls.
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL via
// `inject`), and the app runs in a second page of the same browser, driven
// through the shared `app` wrapper (e2e/support/browser-app.mjs) and the
// consolidated harness helpers in e2e/support/flows.mjs. Files run
// sequentially against one shared server + data dir, so registered
// definitions are delete-first (a fresh run's delete 404s — ignored) — watch
// re-runs never 409 on the previous run's records.
//
// Locator style (ticket 07): standard Playwright CSS selectors pierce the
// app's nested Lit shadow DOM (workflow-instances → flow-overview →
// flow-editor → code-editor/chat-session), so every wait is an auto-retrying
// assertion (app.waitForSelector / app.waitForFunction / expect.poll) — no
// hand-rolled shadow-DOM walkers, no waitForTimeout sleeps. The current
// source is read from the code pane's rendered overlay (`flow-editor .code`,
// which mirrors the textarea's value) and hand edits are written back through
// the editor's own textarea; the no-session screens' textarea value is read
// through the direct document → code-editor → textarea path (only page-side
// code can read a textarea's value property; the fixed path is not a walker).

import { expect, inject, test } from "vitest";
import { app } from "../support/browser-app.mjs";
import {
  captureFailureScreenshot,
  deleteDefinition,
  editorValue,
  fetchJson,
  registerDefinition,
  sendChatMessage,
  sessionState,
  waitForEditorValue,
} from "../support/flows.mjs";

const baseUrl = inject("baseUrl");

test("authoring session renders as the flow editor, co-edits, and saves", async () => {
  captureFailureScreenshot();

  // Definition editor (new definition): start a lucky session. The session's
  // save registers "review-flow"; drop any previous run's record first (the
  // app page must exist before page code can run).
  await app.open(`${baseUrl}/#/flows/new`);
  await deleteDefinition("review-flow");
  await app.waitForSelector("textarea", { timeout: 15_000 });
  await app.fill("textarea", "A review flow with approve and reject actions", {
    first: true,
  });
  await app.click("button", { hasText: "I'm feeling lucky" });

  // The session renders as a flow instance: the flow-editor's header carries
  // the user's prompt, and the editable editor shows the definition module.
  await app.waitForSelector("flow-editor .editor-title", {
    hasText: "A review flow with approve and reject actions",
    timeout: 60_000,
  });
  await app.waitForSelector("flow-editor .code", {
    hasText: "reviewFlow",
    timeout: 60_000,
  });

  // Hand-edit the source (the edit IS the state).
  await app.fill(
    "flow-editor code-editor textarea",
    "export const flow = {}; // manual tweak"
  );

  // The write-back lands: the session source is the manual text. One artifact
  // — the edit IS the state (no divergence flag, no adoption).
  await expect
    .poll(() => sessionState("new"), { timeout: 20_000 })
    .toSatisfy(
      (state) =>
        typeof state?.workflowInstanceState?.source === "string" &&
        state.workflowInstanceState.source.includes("manual tweak")
    );

  // Ask the agent to continue: it reads the current source and proposes in
  // chat instead of overwriting the human's edit.
  expect(await sendChatMessage("please add a reject action")).toBe(true);
  await expect
    .poll(() => sessionState("new"), { timeout: 40_000 })
    .toSatisfy((state) => {
      const messages = state?.runningTaskContext?.messages ?? [];
      return messages.some(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          m.content.includes("manual edits")
      );
    });
  // The human's edit survives the agent's turn (it is the state).
  await expect
    .poll(() => sessionState("new"), { timeout: 20_000 })
    .toSatisfy(
      (state) =>
        typeof state?.workflowInstanceState?.source === "string" &&
        state.workflowInstanceState.source.includes("manual tweak")
    );

  // Regenerate: the agent rewrites the definition module (the manual tweak is
  // gone — the agent took over again).
  expect(await sendChatMessage("regenerate the definition")).toBe(true);
  await expect
    .poll(
      async () => {
        const code = (await app.textContent("flow-editor .code")) ?? "";
        return code.includes("reviewFlow") && !code.includes("manual tweak");
      },
      { timeout: 40_000 }
    )
    .toBe(true);

  // Save registers the definition synchronously; the session is re-keyed
  // under the saved definition and routed to its edit page (still the session).
  await app.click("button", { hasText: "Save definition", first: true });
  await app.waitForSelector(".saved-status", {
    hasText: "review-flow",
    timeout: 40_000,
  });
  await app.waitForFunction(
    () => window.location.hash === "#/flows/review-flow/edit",
    undefined,
    { timeout: 20_000 }
  );
  // The session resumes on the edit page: the saved status is still there.
  await app.waitForSelector(".saved-status", {
    hasText: "review-flow",
    timeout: 40_000,
  });

  // The "done" affordance: Instantiate flow leaves the session for the
  // definition's page (where the instantiate form lives).
  await app.click("button", { hasText: "Instantiate flow", first: true });
  await app.waitForFunction(
    () => window.location.hash === "#/flows/review-flow",
    undefined,
    { timeout: 20_000 }
  );

  const definition = await fetchJson("/api/flows/definitions/review-flow");
  expect(definition?.name).toBe("Review Flow");
  expect(
    definition?.source?.includes("FlowDefinition"),
    "the saved definition source is the definition module"
  ).toBe(true);
  expect(
    definition?.definition?.id === "reviewFlow",
    "the registered record carries the pure-data form"
  ).toBe(true);
});

test("the new-flow screen shows the canonical scaffold as an editable draft", async () => {
  captureFailureScreenshot();

  await app.open(`${baseUrl}/#/flows/new`);
  // The no-session files editor seeds from the canonical scaffold (fetched
  // from the server — the editor carries no copy of its own).
  await waitForEditorValue("myFlow");
  // Tabs: only the Definition tab (the scaffold declares no refs).
  const tabs = await app.evaluate(() =>
    Array.from(document.querySelectorAll(".tab-bar button")).map((tab) =>
      tab.textContent?.trim()
    )
  );
  expect(tabs).toEqual(["Definition"]);
  // The hand-write Save is present and enabled even without edits: saving the
  // scaffold as-is creates the flow (the session is not the only path).
  await app.waitForSelector("button", {
    hasText: "Save as new flow",
    timeout: 15_000,
  });
});

test("hand-writing the scaffold saves a definition without a session", async () => {
  captureFailureScreenshot();

  // The save registers "hand-written"; drop any previous run's record first
  // (the app page must exist before page code can run).
  await app.open(`${baseUrl}/#/flows/new`);
  await deleteDefinition("hand-written");
  await waitForEditorValue("myFlow");
  // Hand-write: rename the scaffold's id and label directly.
  const scaffold = await editorValue();
  await app.fill(
    "code-editor textarea",
    scaffold
      .replace('id: "myFlow",', 'id: "handFlow",')
      .replace('label: "My Flow",', 'label: "Hand Written",')
  );
  // Save without any session: the definition is created from the draft and
  // the editor routes to its edit page.
  await app.click("button", { hasText: "Save as new flow" });
  await app.waitForFunction(
    () => window.location.hash === "#/flows/hand-written/edit",
    undefined,
    { timeout: 20_000 }
  );
  const definition = await fetchJson("/api/flows/definitions/hand-written");
  expect(definition, "the hand-written definition exists").toBeTruthy();
  expect(definition?.name).toBe("Hand Written");
  expect(
    definition?.source?.includes('id: "handFlow"'),
    "the saved source is the hand-written module"
  ).toBe(true);
});

test("a conversation seeds from the editor's scaffold edits", async () => {
  captureFailureScreenshot();

  await app.open(`${baseUrl}/#/flows/new`);
  await waitForEditorValue("myFlow");
  // Edit the scaffold's label before starting the conversation.
  const scaffold = await editorValue();
  await app.fill(
    "code-editor textarea",
    scaffold.replace('label: "My Flow",', 'label: "My Edited Flow",')
  );
  // Start a conversation: the session seeds from the edited scaffold (the
  // edit IS the state — the agent reads it, not a stale copy).
  await app.fill("textarea", "extend the scaffold", { first: true });
  await app.click("button", { hasText: "Start conversation" });
  // The agent read the seeded source and set it back verbatim — the editor
  // shows the human's edited label, not a mock-authored copy.
  await app.waitForSelector("flow-editor .code", { timeout: 40_000 });
  await expect
    .poll(
      async () =>
        ((await app.textContent("flow-editor .code")) ?? "").includes(
          "My Edited Flow"
        ),
      { timeout: 40_000 }
    )
    .toBe(true);
});

// The implemented tool the human types into the referenced-file tab.
const EDITED_TOOL =
  'import { defineTool } from "workflow-engine/runners";\n' +
  "export const websearchTools = [\n" +
  "  defineTool({\n" +
  '    name: "websearch",\n' +
  '    description: "Search the web.",\n' +
  "    parameters: { properties: {}, required: [] },\n" +
  "    executor: async (call) => ({\n" +
  '      toolCallId: call.id, content: "edited result", isError: false,\n' +
  "    }),\n" +
  "  }),\n" +
  "];\n";

// A gate-clean source for the existing-definition revision scenario.
const REVISE_SOURCE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "review-flow",
  label: "Review Flow",
  configSchema: [],
  workflows: [
    {
      id: "review",
      label: "Review",
      instanceState: [],
      initial: "new",
      terminalStates: ["done"],
      states: [
        { id: "new", label: "New", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`;

// A saved definition with no referenced files, for the hand-added-ref test.
const ADD_REF_SOURCE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "add-ref",
  label: "Add Ref",
  configSchema: [],
  workflows: [
    {
      id: "items",
      label: "Items",
      instanceState: [],
      initial: "new",
      terminalStates: ["done"],
      states: [
        { id: "new", label: "New", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`;

test("closing the authoring session keeps the definition's files visible and editable", async () => {
  captureFailureScreenshot();

  // Register a definition to work on (a data module with a referenced file).
  // Navigate first so the page origin matches the API host.
  await app.open(`${baseUrl}/#/flows`);
  const created = await registerDefinition(
    "Close Me",
    CLOSE_SOURCE,
    CLOSE_FILES
  );
  expect(created, "definition registered").toBeTruthy();
  expect(created?.id).toBe("close-me");

  // Start a revision session on it; the session is live (the mock writes its
  // own module into the working copy).
  await app.open(`${baseUrl}/#/flows/close-me/edit`);
  await app.waitForSelector("button", {
    hasText: "Start conversation",
    timeout: 15_000,
  });
  await app.fill("textarea", "Tighten the gate", { first: true });
  await app.click("button", { hasText: "Start conversation" });
  await app.waitForSelector("flow-editor .code", { timeout: 40_000 });
  await expect
    .poll(
      async () =>
        ((await app.textContent("flow-editor .code")) ?? "").includes(
          "FlowDefinition"
        ),
      { timeout: 40_000 }
    )
    .toBe(true);

  // Close the session (a shell button, not inside the flow-editor): the
  // persistent files stay visible and editable — the session was a
  // collaborator, not the only way to see the flow.
  await app.click("button.author-close");
  // The no-session files editor binds the saved source once the detail
  // refreshes (the close also re-fetches it).
  await waitForEditorValue("closeFlow");
  const tabs = await app.evaluate(() =>
    Array.from(document.querySelectorAll(".tab-bar button")).map((tab) =>
      tab.textContent?.trim()
    )
  );
  expect(
    tabs.includes("./tools/search.ts"),
    `the referenced file tab is visible: ${tabs.join(", ")}`
  ).toBe(true);

  // The no-session files editor is editable: change the label, save
  // explicitly, and the definition updates.
  const source = await editorValue();
  await app.fill(
    "code-editor textarea",
    source.replace('label: "Close Me",', 'label: "Close Me (edited)",')
  );
  await app.waitForFunction(
    () => {
      const save = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Save definition")
      );
      return save !== undefined && !save.disabled;
    },
    undefined,
    { timeout: 15_000 }
  );
  await app.click("button", { hasText: "Save definition" });
  await app.waitForSelector(".saved-status", { timeout: 15_000 });

  // The definition survives and the explicit save persisted the edit.
  const definition = await fetchJson("/api/flows/definitions/close-me");
  expect(
    definition,
    "the saved definition survives closing the session"
  ).toBeTruthy();
  expect(definition?.name).toBe("Close Me");
  expect(
    definition?.source?.includes("Close Me (edited)"),
    "the explicit save persisted the edit"
  ).toBe(true);
});

// A registered definition the close-session test works on (a data module with
// a referenced file, so the no-session files editor shows a file tab).
const CLOSE_SOURCE = `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "closeFlow",
  label: "Close Me",
  configSchema: [],
  tools: [{ id: "websearch", ref: "./tools/search.ts" }],
  workflows: [
    {
      id: "items",
      label: "Items",
      instanceState: [{ field: "title", type: "string" }],
      initial: "new",
      terminalStates: ["done"],
      states: [
        { id: "new", label: "New", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};
`;

const CLOSE_FILES = {
  "./tools/search.ts": "export const searchTools = [];\n",
};

test("hand edits are the state: the agent continues with them in force", async () => {
  captureFailureScreenshot();

  // Lucky session: the generated definition module renders as the editor.
  await app.open(`${baseUrl}/#/flows/new`);
  await app.waitForSelector("textarea", { timeout: 15_000 });
  await app.fill("textarea", "A review flow with approve and reject actions", {
    first: true,
  });
  await app.click("button", { hasText: "I'm feeling lucky" });
  await app.waitForSelector("flow-editor .editor-title", {
    hasText: "A review flow with approve and reject actions",
    timeout: 60_000,
  });
  await app.waitForSelector("flow-editor .code", {
    hasText: "reviewFlow",
    timeout: 60_000,
  });

  // The human edits the source: a label change. The current source is read
  // from the code pane's rendered overlay (`.code` mirrors the textarea's
  // value), then written back through the editor.
  const source = (await app.textContent("flow-editor .code")) ?? "";
  await app.fill(
    "flow-editor code-editor textarea",
    source.replace(
      'label: "Review Flow",',
      'label: "Review Flow (hand edited)",'
    )
  );

  // The write-back lands: the session source is the manual text — in force,
  // no adoption and no divergence flag.
  await expect
    .poll(() => sessionState("new"), { timeout: 20_000 })
    .toSatisfy(
      (state) =>
        typeof state?.workflowInstanceState?.source === "string" &&
        state.workflowInstanceState.source.includes("hand edited") &&
        state.workflowInstanceState.blueprintDiverged !== true
    );

  // The agent continues: a message drives a turn where it reads the current
  // source (read_definition_source — the hand edit is the state) and proposes
  // in chat without overwriting; the edit stays in force.
  expect(await sendChatMessage("continue the session")).toBe(true);
  await expect
    .poll(() => sessionState("new"), { timeout: 40_000 })
    .toSatisfy((state) => {
      const messages = state?.runningTaskContext?.messages ?? [];
      return messages.some(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          m.content.includes("manual edits")
      );
    });
  await expect
    .poll(() => sessionState("new"), { timeout: 20_000 })
    .toSatisfy(
      (state) =>
        typeof state?.workflowInstanceState?.source === "string" &&
        state.workflowInstanceState.source.includes("hand edited")
    );
});

test("revising an existing definition starts a session with its source as context", async () => {
  captureFailureScreenshot();

  // Register a definition to revise.
  const created = await registerDefinition("Revise Me", REVISE_SOURCE);
  expect(created, "definition registered").toBeTruthy();
  expect(created?.id).toBe("revise-me");

  // The edit route shows the start-session state (no session auto-resumes for
  // a definition that has never been authored).
  await app.open(`${baseUrl}/#/flows/revise-me/edit`);
  await app.waitForSelector("button", {
    hasText: "Start conversation",
    timeout: 15_000,
  });
  await app.fill("textarea", "Add a second workflow", { first: true });
  await app.click("button", { hasText: "Start conversation" });

  // The session's first user message carries the existing source as context,
  // so the agent proposes changes to the real definition rather than from
  // scratch.
  await expect
    .poll(() => sessionState("revise-me"), { timeout: 40_000 })
    .toSatisfy((state) => {
      const messages = state?.runningTaskContext?.messages ?? [];
      return messages.some(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.includes("review-flow")
      );
    });
});

test("a referenced file opens as an editable tab and the edit persists across a reload", async () => {
  captureFailureScreenshot();

  // Register a definition to author (an existing-definition session resumes
  // across a reload; a new-definition session intentionally starts fresh).
  await app.open(`${baseUrl}/#/flows`);
  const created = await registerDefinition("Tab Me", REVISE_SOURCE);
  expect(created, "definition registered").toBeTruthy();
  expect(created?.id).toBe("tab-me");

  // Start a session: the mock's definition module declares a referenced tool,
  // so the set is a module set and the editor shows file tabs.
  await app.open(`${baseUrl}/#/flows/tab-me/edit`);
  await app.waitForSelector("button", {
    hasText: "Start conversation",
    timeout: 15_000,
  });
  await app.fill("textarea", "Add a websearch tool", { first: true });
  await app.click("button", { hasText: "Start conversation" });

  // The editor shows the Definition tab and a tab per referenced file.
  await app.waitForSelector("button.tab", {
    hasText: "Definition",
    timeout: 40_000,
  });
  await app.waitForSelector("button.tab", {
    hasText: "./tools/websearch.ts",
    timeout: 40_000,
  });

  // Open the referenced file: the editor shows its (unwritten) pane; the
  // human implements it directly.
  await app.click("button.tab", {
    hasText: "./tools/websearch.ts",
    first: true,
  });
  await app.waitForSelector("flow-editor .code", { timeout: 40_000 });

  // Edit the file: the write-back lands in the session (authoritative).
  await app.fill("flow-editor code-editor textarea", EDITED_TOOL);
  await expect
    .poll(() => sessionState("tab-me"), { timeout: 20_000 })
    .toSatisfy(
      (state) =>
        typeof state?.workflowInstanceState?.files?.["./tools/websearch.ts"] ===
          "string" &&
        state.workflowInstanceState.files["./tools/websearch.ts"].includes(
          "edited result"
        )
    );

  // Reload: the session resumes and the edited file content is still there.
  await app.reload();
  await app.waitForSelector("button.tab", {
    hasText: "./tools/websearch.ts",
    timeout: 40_000,
  });
  await app.click("button.tab", {
    hasText: "./tools/websearch.ts",
    first: true,
  });
  await expect
    .poll(
      async () =>
        ((await app.textContent("flow-editor .code")) ?? "").includes(
          "edited result"
        ),
      { timeout: 40_000 }
    )
    .toBe(true);
});

test("revising an existing definition shows its referenced files as editable tabs", async () => {
  captureFailureScreenshot();

  // Register a module-set definition with a referenced file.
  await app.open(`${baseUrl}/#/flows`);
  const created = await registerDefinition(
    "Tab Seed",
    `import type { FlowDefinition } from "workflow-engine/workflow-types";

export const flow: FlowDefinition = {
  id: "tab-seed",
  label: "Tab Seed",
  configSchema: [],
  workflows: [
    {
      id: "items",
      label: "Items",
      instanceState: [],
      initial: "new",
      terminalStates: ["done"],
      states: [
        { id: "new", label: "New", category: "initial" },
        { id: "done", label: "Done", category: "terminal" },
      ],
    },
  ],
  edges: [],
};`,
    { "./gates/approved.ts": "export const ok = true;\n" }
  );
  expect(created, "definition registered").toBeTruthy();
  expect(created?.id).toBe("tab-seed");

  // Start a revision session — the seeded file appears as an editable tab.
  await app.open(`${baseUrl}/#/flows/tab-seed/edit`);
  await app.waitForSelector("button", {
    hasText: "Start conversation",
    timeout: 15_000,
  });
  await app.fill("textarea", "Tighten the gate", { first: true });
  await app.click("button", { hasText: "Start conversation" });
  await app.waitForSelector("button.tab", {
    hasText: "./gates/approved.ts",
    timeout: 40_000,
  });

  // Open it: the seeded content is there (the file is editable in-conversation).
  await app.click("button.tab", {
    hasText: "./gates/approved.ts",
    first: true,
  });
  await app.waitForSelector("flow-editor .code", { timeout: 40_000 });
  await expect
    .poll(
      async () =>
        ((await app.textContent("flow-editor .code")) ?? "").includes(
          "export const ok = true;"
        ),
      { timeout: 40_000 }
    )
    .toBe(true);
});

test("hand-adding a ref to a saved definition shows its tab and saves the file", async () => {
  captureFailureScreenshot();

  // A saved definition with no referenced files.
  await app.open(`${baseUrl}/#/flows`);
  const created = await registerDefinition("Add Ref", ADD_REF_SOURCE);
  expect(created, "definition registered").toBeTruthy();
  expect(created?.id).toBe("add-ref");

  // Hand-edit the source to declare a referenced tool.
  await app.open(`${baseUrl}/#/flows/add-ref/edit`);
  await waitForEditorValue("add-ref");
  const source = await editorValue();
  await app.fill(
    "code-editor textarea",
    source.replace(
      "configSchema: [],",
      'configSchema: [],\n  tools: [{ id: "websearch", ref: "./tools/websearch.ts", writes: [] }],'
    )
  );

  // The declared-but-unwritten ref gets a tab, derived from the source.
  await app.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".tab-bar button")).some(
        (b) => b.textContent?.trim() === "./tools/websearch.ts"
      ),
    undefined,
    { timeout: 15_000 }
  );

  // Write the referenced file by hand.
  await app.click(".tab-bar button", { hasText: "./tools/websearch.ts" });
  await app.waitForSelector("code-editor textarea", { timeout: 10_000 });
  await app.fill("code-editor textarea", EDITED_TOOL);

  // Save: the module + the hand-written file register together.
  await app.click("button", { hasText: "Save definition" });
  await app.waitForSelector(".saved-status", { timeout: 20_000 });

  const definition = await fetchJson("/api/flows/definitions/add-ref");
  expect(definition, "the definition survives the save").toBeTruthy();
  expect(
    definition?.source?.includes('ref: "./tools/websearch.ts"'),
    "the edited source is persisted"
  ).toBe(true);
  expect(
    definition?.files?.["./tools/websearch.ts"]?.includes("websearchTools"),
    "the hand-written referenced file is persisted"
  ).toBe(true);
});

test("a built-in flow definition is viewable read-only (View instead of Edit)", async () => {
  captureFailureScreenshot();

  await app.open(`${baseUrl}/#/flows/queen-bee`);
  // The built-in's definition page offers View (never Edit).
  await app.waitForSelector("a", { hasText: "View", timeout: 20_000 });
  await app.click("a", { hasText: "View", first: true });

  // The read-only viewer shows the preset's entry source on the Definition tab.
  await app.waitForSelector("code-editor", { timeout: 20_000 });
  const code = await editorValue();
  expect(
    code.includes('id: "queen-bee"') &&
      code.includes("export const flow: FlowDefinition = {"),
    "the preset's definition module source must be viewable"
  ).toBe(true);
  const disabled = await app.evaluate(() => {
    const editor = document.querySelector("code-editor");
    return editor?.shadowRoot?.querySelector("textarea")?.disabled ?? false;
  });
  expect(disabled, "the viewer is read-only").toBe(true);
});
