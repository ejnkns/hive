// The flow editor as a rendered flow instantiation, end to end: a lucky-mode
// authoring session renders as a flow instance (the built-in flow-editor
// composing header, chat, editable definition module, and save), and the
// one-artifact co-editing loop works — hand edits write back (the edit IS the
// state), the agent reads the current source and builds on it without
// overwriting, and a regenerate takes the definition back. One session, a
// bounded set of scripted model calls.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startHiveTestApp } from "./support/hive-test-app.mjs";
import { startMockProvider } from "./support/mock-provider.mjs";

let mock;
let app;
let page;
let baseUrl;

before(async () => {
  mock = await startMockProvider();
  app = await startHiveTestApp(mock.host);
  page = app.page;
  baseUrl = app.baseUrl;
});

after(async () => {
  await app.close();
  await mock.close();
});

// The flow-editor's live state: header title, code-pane text, chat text,
// and every visible button, across nested shadow roots.
async function editorState() {
  return page.evaluate(() => {
    const walk = (root) => {
      for (const el of root.querySelectorAll("flow-editor")) return el;
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const found = walk(el.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };
    const host = document.querySelector("workflow-instances");
    const editor = walk(host?.shadowRoot ?? document);
    if (!editor?.shadowRoot) return null;
    const shadow = editor.shadowRoot;
    const firstText = (root, selector) => {
      for (const el of root.querySelectorAll(selector)) {
        return el.textContent ?? "";
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const found = firstText(el.shadowRoot, selector);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    };
    const title =
      shadow.querySelector(".editor-title")?.textContent?.trim() ?? null;
    const code = firstText(shadow, ".code") ?? "";
    const tabs = [];
    for (const tab of shadow.querySelectorAll("button.tab")) {
      const label = tab.textContent?.trim();
      if (label && !tabs.includes(label)) tabs.push(label);
    }
    const saved =
      shadow.querySelector(".saved-status")?.textContent?.trim() ?? "";
    const buttons = [];
    const walkButtons = (root) => {
      for (const el of root.querySelectorAll("button")) {
        const t = el.textContent?.trim();
        if (t && !buttons.includes(t)) buttons.push(t);
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) walkButtons(el.shadowRoot);
      }
    };
    walkButtons(shadow);
    return { title, code, saved, buttons, tabs };
  });
}

async function waitForEditor(predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await editorState();
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the flow editor");
}

// Clicks the button with the exact label inside the workflow-instances shadow
// tree.
async function clickEditorButton(buttonLabel, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate((buttonLabel) => {
      const walk = (root) => {
        for (const el of root.querySelectorAll("button")) {
          if (el.textContent?.trim() === buttonLabel) return el;
        }
        for (const el of root.querySelectorAll("*")) {
          if (el.shadowRoot) {
            const found = walk(el.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      };
      const host = document.querySelector("workflow-instances");
      const button = walk(host?.shadowRoot ?? document);
      if (!button) return false;
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true })
      );
      return true;
    }, buttonLabel);
    if (clicked) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Clicks a flow-editor tab by its label (Definition / file path).
async function clickEditorTab(tabLabel, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate((tabLabel) => {
      const walk = (root) => {
        for (const el of root.querySelectorAll("button.tab")) {
          if (el.textContent?.trim() === tabLabel) return el;
        }
        for (const el of root.querySelectorAll("*")) {
          if (el.shadowRoot) {
            const found = walk(el.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      };
      const host = document.querySelector("workflow-instances");
      const tab = walk(host?.shadowRoot ?? document);
      if (!tab) return false;
      tab.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true })
      );
      return true;
    }, tabLabel);
    if (clicked) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Replaces the active code editor's text (the active tab's editor).
async function editActiveEditor(text) {
  return editDefinitionSource(text);
}

// Replaces the flow-editor's editable source with the given text.
async function editDefinitionSource(text) {
  return page.evaluate((text) => {
    const walk = (root) => {
      for (const el of root.querySelectorAll("code-editor")) {
        const textarea = el.shadowRoot?.querySelector("textarea");
        if (textarea) return textarea;
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const found = walk(el.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };
    const host = document.querySelector("workflow-instances");
    const textarea = walk(host?.shadowRoot ?? document);
    if (!textarea) return false;
    textarea.value = text;
    textarea.dispatchEvent(
      new Event("input", { bubbles: true, composed: true })
    );
    return true;
  }, text);
}

// Sends a chat message to the session's chat-session input.
async function sendChatMessage(text) {
  return page.evaluate((text) => {
    const walk = (root) => {
      for (const el of root.querySelectorAll("chat-session")) {
        const input = el.shadowRoot?.querySelector("input");
        if (input) return { session: el, input };
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const found = walk(el.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };
    const host = document.querySelector("workflow-instances");
    const found = walk(host?.shadowRoot ?? document);
    if (!found) return false;
    found.input.value = text;
    found.input.dispatchEvent(
      new Event("input", { bubbles: true, composed: true })
    );
    const send = found.session.shadowRoot?.querySelector("button");
    if (send) {
      send.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true })
      );
    }
    return true;
  }, text);
}

// The session's live instance state, read via REST (the flow is hidden, so
// the library list does not include it — fetch by the stored id). The storage
// key is per definition ("new" for a new definition, the id otherwise).
async function sessionState(definitionKey = "new") {
  return page.evaluate(async (definitionKey) => {
    const stored = localStorage.getItem(`hive:author:${definitionKey}`);
    if (!stored) return null;
    const res = await fetch(`/api/flows/${encodeURIComponent(stored)}`);
    if (!res.ok) return null;
    const flow = await res.json();
    return flow.instances?.[0]?.state ?? null;
  }, definitionKey);
}

async function waitForSessionState(
  predicate,
  timeoutMs = 20_000,
  definitionKey = "new"
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await sessionState(definitionKey);
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the session state");
}

test("authoring session renders as the flow editor, co-edits, and saves", async () => {
  // Definition editor (new definition): start a lucky session.
  await page.goto(`${baseUrl}/#/flows/new`);
  await page.waitForSelector("textarea", { timeout: 15_000 });
  await page
    .locator("textarea")
    .first()
    .fill("A review flow with approve and reject actions");
  await page.locator("button", { hasText: "I'm feeling lucky" }).click();

  // The session renders as a flow instance: the flow-editor's header carries
  // the user's prompt, and the editable editor shows the definition module.
  await waitForEditor(
    (state) => state.title === "A review flow with approve and reject actions"
  );
  await waitForEditor((state) => state.code.includes("reviewFlow"));
  assert.ok(
    await editDefinitionSource("export const flow = {}; // manual tweak"),
    "the editable source is present"
  );

  // The write-back lands: the session source is the manual text. One artifact
  // — the edit IS the state (no divergence flag, no adoption).
  await waitForSessionState(
    (state) =>
      typeof state.workflowInstanceState?.source === "string" &&
      state.workflowInstanceState.source.includes("manual tweak")
  );

  // Ask the agent to continue: it reads the current source and proposes in
  // chat instead of overwriting the human's edit.
  assert.ok(await sendChatMessage("please add a reject action"));
  await waitForSessionState((state) => {
    const messages = state.runningTaskContext?.messages ?? [];
    return messages.some(
      (m) =>
        m.role === "assistant" &&
        typeof m.content === "string" &&
        m.content.includes("manual edits")
    );
  }, 40_000);
  // The human's edit survives the agent's turn (it is the state).
  await waitForSessionState(
    (state) =>
      typeof state.workflowInstanceState?.source === "string" &&
      state.workflowInstanceState.source.includes("manual tweak")
  );

  // Regenerate: the agent rewrites the definition module (the manual tweak is
  // gone — the agent took over again).
  assert.ok(await sendChatMessage("regenerate the definition"));
  await waitForEditor(
    (state) =>
      state.code.includes("reviewFlow") && !state.code.includes("manual tweak"),
    40_000
  );

  // Save registers the definition synchronously; the session is re-keyed
  // under the saved definition and routed to its edit page (still the session).
  assert.ok(
    await clickEditorButton("Save definition"),
    "the save button is available and clicked"
  );
  await waitForEditor((state) => state.saved.includes("review-flow"));
  await waitFor(
    async () =>
      (await page.evaluate(() => window.location.hash)) ===
      "#/flows/review-flow/edit"
  );
  // The session resumes on the edit page: the saved status is still there.
  await waitForEditor((state) => state.saved.includes("review-flow"));

  // The "done" affordance: Instantiate flow leaves the session for the
  // definition's page (where the instantiate form lives).
  assert.ok(
    await clickEditorButton("Instantiate flow"),
    "the instantiate button appears once the definition is saved"
  );
  await waitFor(
    async () =>
      (await page.evaluate(() => window.location.hash)) ===
      "#/flows/review-flow"
  );

  const definition = await page.evaluate(async () => {
    const res = await fetch("/api/flows/definitions/review-flow");
    return res.ok ? await res.json() : null;
  });
  assert.equal(definition?.name, "Review Flow");
  assert.ok(
    definition?.source?.includes("FlowDefinition"),
    "the saved definition source is the definition module"
  );
  assert.ok(
    definition?.definition?.id === "reviewFlow",
    "the registered record carries the pure-data form"
  );
});

// Polls until a predicate returns a truthy value.
async function waitFor(predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out");
}

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
const REVISE_SOURCE = `import { defineWorkflow } from "workflow-engine/workflow-types";

const wf = defineWorkflow({
  id: "review",
  label: "Review",
  taskOutputs: {} as Record<string, never>,
  workflowInstanceState: {} as Record<string, unknown>,
  states: [
    { id: "new", label: "New", category: "initial" },
    { id: "done", label: "Done", category: "terminal" },
  ],
  initial: "new",
  terminalStates: ["done"],
});

export const flow = {
  id: "review-flow",
  label: "Review Flow",
  configSchema: [],
  workflows: [wf],
  edges: [],
};
`;

test("closing the authoring session keeps the definition's files visible and editable", async () => {
  // Register a definition to work on (a data module with a referenced file).
  // Navigate first so the page origin matches the API host.
  await page.goto(`${baseUrl}/#/flows`);
  const created = await page.evaluate(
    async ({ source, files, baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/flows/definitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Close Me", source, files }),
      });
      return res.ok ? await res.json() : null;
    },
    { source: CLOSE_SOURCE, files: CLOSE_FILES, baseUrl }
  );
  assert.ok(created, "definition registered");
  assert.equal(created?.id, "close-me");

  // Start a revision session on it; the session is live (the mock writes its
  // own module into the working copy).
  await page.goto(`${baseUrl}/#/flows/close-me/edit`);
  await page.waitForSelector(
    "button",
    { hasText: "Start conversation" },
    { timeout: 15_000 }
  );
  await page.locator("textarea").first().fill("Tighten the gate");
  await page.locator("button", { hasText: "Start conversation" }).click();
  await waitForEditor((state) => state.code.includes("FlowDefinition"), 40_000);

  // Close the session (a shell button, not inside the flow-editor): the
  // persistent files stay visible and editable — the session was a
  // collaborator, not the only way to see the flow.
  await page.locator("button.author-close").click();
  // The no-session files editor binds the saved source once the detail
  // refreshes (the close also re-fetches it).
  await page.waitForFunction(
    () =>
      document
        .querySelector("code-editor")
        ?.shadowRoot?.querySelector("textarea")
        ?.value?.includes("closeFlow") ?? false,
    { timeout: 15_000 }
  );
  const tabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".tab-bar button")).map((tab) =>
      tab.textContent?.trim()
    )
  );
  assert.ok(
    tabs.includes("./tools/search.ts"),
    `the referenced file tab is visible: ${tabs.join(", ")}`
  );

  // The no-session files editor is editable: change the label, save
  // explicitly, and the definition updates.
  const edited = await page.evaluate(() => {
    const textarea = document
      .querySelector("code-editor")
      ?.shadowRoot?.querySelector("textarea");
    if (!textarea) return false;
    textarea.value = textarea.value.replace(
      'label: "Close Me",',
      'label: "Close Me (edited)",'
    );
    textarea.dispatchEvent(
      new Event("input", { bubbles: true, composed: true })
    );
    return true;
  });
  assert.ok(edited, "the no-session editor must be editable");
  await page.waitForFunction(
    () => {
      const save = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Save definition")
      );
      return save !== undefined && !save.disabled;
    },
    { timeout: 15_000 }
  );
  await page.locator("button", { hasText: "Save definition" }).click();
  await page.waitForSelector(".saved-status", { timeout: 15_000 });

  // The definition survives and the explicit save persisted the edit.
  const definition = await page.evaluate(async () => {
    const res = await fetch("/api/flows/definitions/close-me");
    return res.ok ? await res.json() : null;
  });
  assert.ok(definition, "the saved definition survives closing the session");
  assert.equal(definition?.name, "Close Me");
  assert.ok(
    definition?.source?.includes("Close Me (edited)"),
    "the explicit save persisted the edit"
  );
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
  // Lucky session: the generated definition module renders as the editor.
  await page.goto(`${baseUrl}/#/flows/new`);
  await page.waitForSelector("textarea", { timeout: 15_000 });
  await page
    .locator("textarea")
    .first()
    .fill("A review flow with approve and reject actions");
  await page.locator("button", { hasText: "I'm feeling lucky" }).click();
  await waitForEditor(
    (state) => state.title === "A review flow with approve and reject actions"
  );
  await waitForEditor((state) => state.code.includes("reviewFlow"));

  // The human edits the source: a label change.
  const edited = await page.evaluate(() => {
    const walk = (root) => {
      for (const el of root.querySelectorAll("code-editor")) {
        const textarea = el.shadowRoot?.querySelector("textarea");
        if (textarea) return textarea;
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const found = walk(el.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };
    const host = document.querySelector("workflow-instances");
    const textarea = walk(host?.shadowRoot ?? document);
    if (!textarea) return false;
    textarea.value = textarea.value.replace(
      'label: "Review Flow",',
      'label: "Review Flow (hand edited)",'
    );
    textarea.dispatchEvent(
      new Event("input", { bubbles: true, composed: true })
    );
    return true;
  });
  assert.ok(edited, "the editor must be editable");

  // The write-back lands: the session source is the manual text — in force,
  // no adoption and no divergence flag.
  await waitForSessionState(
    (state) =>
      typeof state.workflowInstanceState?.source === "string" &&
      state.workflowInstanceState.source.includes("hand edited") &&
      state.workflowInstanceState.blueprintDiverged !== true
  );

  // The agent continues: a message drives a turn where it reads the current
  // source (read_definition_source — the hand edit is the state) and proposes
  // in chat without overwriting; the edit stays in force.
  assert.ok(await sendChatMessage("continue the session"));
  await waitForSessionState((state) => {
    const messages = state.runningTaskContext?.messages ?? [];
    return messages.some(
      (m) =>
        m.role === "assistant" &&
        typeof m.content === "string" &&
        m.content.includes("manual edits")
    );
  }, 40_000);
  await waitForSessionState(
    (state) =>
      typeof state.workflowInstanceState?.source === "string" &&
      state.workflowInstanceState.source.includes("hand edited"),
    20_000
  );
});

test("revising an existing definition starts a session with its source as context", async () => {
  // Register a definition to revise.
  const created = await page.evaluate(async (source) => {
    const res = await fetch("/api/flows/definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Revise Me", source }),
    });
    return res.ok ? await res.json() : null;
  }, REVISE_SOURCE);
  assert.ok(created, "definition registered");
  assert.equal(created?.id, "revise-me");

  // The edit route shows the start-session state (no session auto-resumes for
  // a definition that has never been authored).
  await page.goto(`${baseUrl}/#/flows/revise-me/edit`);
  await page.waitForSelector(
    "button",
    { hasText: "Start conversation" },
    {
      timeout: 15_000,
    }
  );
  await page.locator("textarea").first().fill("Add a second workflow");
  await page.locator("button", { hasText: "Start conversation" }).click();

  // The session's first user message carries the existing source as context,
  // so the agent proposes changes to the real definition rather than from
  // scratch.
  await waitForSessionState(
    (state) => {
      const messages = state.runningTaskContext?.messages ?? [];
      return messages.some(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.includes("review-flow")
      );
    },
    40_000,
    "revise-me"
  );
});

test("a referenced file opens as an editable tab and the edit persists across a reload", async () => {
  // Register a definition to author (an existing-definition session resumes
  // across a reload; a new-definition session intentionally starts fresh).
  await page.goto(`${baseUrl}/#/flows`);
  const created = await page.evaluate(async (source) => {
    const res = await fetch("/api/flows/definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tab Me", source }),
    });
    return res.ok ? await res.json() : null;
  }, REVISE_SOURCE);
  assert.ok(created, "definition registered");
  assert.equal(created?.id, "tab-me");

  // Start a session: the mock's definition module declares a referenced tool,
  // so the set is a module set and the editor shows file tabs.
  await page.goto(`${baseUrl}/#/flows/tab-me/edit`);
  await page.waitForSelector(
    "button",
    { hasText: "Start conversation" },
    { timeout: 15_000 }
  );
  await page.locator("textarea").first().fill("Add a websearch tool");
  await page.locator("button", { hasText: "Start conversation" }).click();

  // The editor shows the Definition tab and a tab per referenced file.
  await waitForEditor(
    (state) =>
      state.tabs.includes("Definition") &&
      state.tabs.includes("./tools/websearch.ts"),
    40_000
  );

  // Open the referenced file: the editor shows its (unwritten) pane; the
  // human implements it directly.
  assert.ok(
    await clickEditorTab("./tools/websearch.ts"),
    "the referenced file tab must be clickable"
  );
  await waitForEditor(
    (state) => state.code !== "" || state.code === "",
    40_000
  );

  // Edit the file: the write-back lands in the session (authoritative).
  assert.ok(await editActiveEditor(EDITED_TOOL), "the file editor is editable");
  await waitForSessionState(
    (state) =>
      typeof state.workflowInstanceState?.files?.["./tools/websearch.ts"] ===
        "string" &&
      state.workflowInstanceState.files["./tools/websearch.ts"].includes(
        "edited result"
      ),
    20_000,
    "tab-me"
  );

  // Reload: the session resumes and the edited file content is still there.
  await page.reload();
  await waitForEditor(
    (state) => state.tabs.includes("./tools/websearch.ts"),
    40_000
  );
  assert.ok(await clickEditorTab("./tools/websearch.ts"));
  await waitForEditor((state) => state.code.includes("edited result"), 40_000);
});

test("revising an existing definition shows its referenced files as editable tabs", async () => {
  // Register a module-set definition with a referenced file.
  await page.goto(`${baseUrl}/#/flows`);
  const created = await page.evaluate(async () => {
    const res = await fetch("/api/flows/definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Tab Seed",
        source: "export const flow = { id: 'tab-seed' };",
        files: { "./gates/approved.ts": "export const ok = true;\n" },
      }),
    });
    return res.ok ? await res.json() : null;
  });
  assert.ok(created, "definition registered");
  assert.equal(created?.id, "tab-seed");

  // Start a revision session — the seeded file appears as an editable tab.
  await page.goto(`${baseUrl}/#/flows/tab-seed/edit`);
  await page.waitForSelector(
    "button",
    { hasText: "Start conversation" },
    { timeout: 15_000 }
  );
  await page.locator("textarea").first().fill("Tighten the gate");
  await page.locator("button", { hasText: "Start conversation" }).click();
  await waitForEditor(
    (state) => state.tabs.includes("./gates/approved.ts"),
    40_000
  );

  // Open it: the seeded content is there (the file is editable in-conversation).
  assert.ok(await clickEditorTab("./gates/approved.ts"));
  await waitForEditor(
    (state) => state.code.includes("export const ok = true;"),
    40_000
  );
});

test("a built-in flow definition is viewable read-only (View instead of Edit)", async () => {
  await page.goto(`${baseUrl}/#/flows/queen-bee`);
  // The built-in's definition page offers View (never Edit).
  await page.waitForSelector("a", { hasText: "View" }, { timeout: 20_000 });
  await page.locator("a", { hasText: "View" }).first().click();

  // The read-only viewer shows the preset's entry source on the Definition tab.
  await page.waitForSelector("code-editor", { timeout: 20_000 });
  const code = await page.evaluate(() => {
    const editor = document.querySelector("code-editor");
    return editor?.shadowRoot?.querySelector("textarea")?.value ?? "";
  });
  assert.ok(
    code.includes('id: "queen-bee"') &&
      code.includes("export const flow: FlowDefinition = {"),
    "the preset's definition module source must be viewable"
  );
  const disabled = await page.evaluate(() => {
    const editor = document.querySelector("code-editor");
    return editor?.shadowRoot?.querySelector("textarea")?.disabled ?? false;
  });
  assert.equal(disabled, true, "the viewer is read-only");
});
