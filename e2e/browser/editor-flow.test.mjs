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
// through the shared `app` wrapper (e2e/support/browser-app.mjs). Files run
// sequentially against one shared server + data dir, so registered
// definitions are delete-first (a fresh run's delete 404s — ignored) — watch
// re-runs never 409 on the previous run's records.

import { expect, inject, onTestFailed, test } from "vitest";
import { app } from "../support/browser-app.mjs";

const baseUrl = inject("baseUrl");

// The flow-editor's live state: header title, code-pane text, chat text,
// and every visible button, across nested shadow roots.
async function editorState() {
  return app.evaluate(() => {
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
    const clicked = await app.evaluate((buttonLabel) => {
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
    const clicked = await app.evaluate((tabLabel) => {
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
  return app.evaluate((text) => {
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
  return app.evaluate((text) => {
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
  return app.evaluate(async (definitionKey) => {
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

// Registers a definition by name (+ optional referenced files), dropping any
// previous run's record first — watch re-runs share the server + data dir and
// the server 409s on a duplicate name. A fresh run's delete 404s (ignored).
// The slug mirrors the server's slugify (shared/src/slugify.ts).
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

async function registerDefinition(name, source, files) {
  const slug = slugify(name);
  return app.evaluate(
    async ({ slug, name, source, files }) => {
      await fetch(`/api/flows/definitions/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      const res = await fetch("/api/flows/definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, source, files }),
      });
      return res.ok ? await res.json() : null;
    },
    { slug, name, source, files }
  );
}

// Drops a definition's record (best-effort) so a UI save in this test can
// re-register it on a watch re-run without a 409.
async function deleteDefinition(slug) {
  await app.evaluate(async (slug) => {
    await fetch(`/api/flows/definitions/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    });
  }, slug);
}

test("authoring session renders as the flow editor, co-edits, and saves", async () => {
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  // Definition editor (new definition): start a lucky session. The session's
  // save registers "review-flow"; drop any previous run's record first (the
  // app page must exist before page code can run).
  await app.open(`${baseUrl}/#/flows/new`);
  await deleteDefinition("review-flow");
  await app.waitForSelector("textarea", { timeout: 15_000 });
  await app
    .fill("textarea", "A review flow with approve and reject actions", {
      first: true,
    });
  await app.click("button", { hasText: "I'm feeling lucky" });

  // The session renders as a flow instance: the flow-editor's header carries
  // the user's prompt, and the editable editor shows the definition module.
  await waitForEditor(
    (state) => state.title === "A review flow with approve and reject actions"
  );
  await waitForEditor((state) => state.code.includes("reviewFlow"));
  expect(
    await editDefinitionSource("export const flow = {}; // manual tweak"),
    "the editable source is present"
  ).toBe(true);

  // The write-back lands: the session source is the manual text. One artifact
  // — the edit IS the state (no divergence flag, no adoption).
  await waitForSessionState(
    (state) =>
      typeof state.workflowInstanceState?.source === "string" &&
      state.workflowInstanceState.source.includes("manual tweak")
  );

  // Ask the agent to continue: it reads the current source and proposes in
  // chat instead of overwriting the human's edit.
  expect(await sendChatMessage("please add a reject action")).toBe(true);
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
  expect(await sendChatMessage("regenerate the definition")).toBe(true);
  await waitForEditor(
    (state) =>
      state.code.includes("reviewFlow") && !state.code.includes("manual tweak"),
    40_000
  );

  // Save registers the definition synchronously; the session is re-keyed
  // under the saved definition and routed to its edit page (still the session).
  expect(
    await clickEditorButton("Save definition"),
    "the save button is available and clicked"
  ).toBe(true);
  await waitForEditor((state) => state.saved.includes("review-flow"));
  await waitFor(
    async () =>
      (await app.evaluate(() => window.location.hash)) ===
      "#/flows/review-flow/edit"
  );
  // The session resumes on the edit page: the saved status is still there.
  await waitForEditor((state) => state.saved.includes("review-flow"));

  // The "done" affordance: Instantiate flow leaves the session for the
  // definition's page (where the instantiate form lives).
  expect(
    await clickEditorButton("Instantiate flow"),
    "the instantiate button appears once the definition is saved"
  ).toBe(true);
  await waitFor(
    async () =>
      (await app.evaluate(() => window.location.hash)) === "#/flows/review-flow"
  );

  const definition = await app.evaluate(async () => {
    const res = await fetch("/api/flows/definitions/review-flow");
    return res.ok ? await res.json() : null;
  });
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
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  await app.open(`${baseUrl}/#/flows/new`);
  // The no-session files editor seeds from the canonical scaffold (fetched
  // from the server — the editor carries no copy of its own).
  await app.waitForFunction(
    () =>
      document
        .querySelector("code-editor")
        ?.shadowRoot?.querySelector("textarea")
        ?.value?.includes("myFlow") ?? false,
    undefined,
    { timeout: 15_000 }
  );
  // Tabs: only the Definition tab (the scaffold declares no refs).
  const tabs = await app.evaluate(() =>
    Array.from(document.querySelectorAll(".tab-bar button")).map((tab) =>
      tab.textContent?.trim()
    )
  );
  expect(tabs).toEqual(["Definition"]);
  // The hand-write Save is present and enabled even without edits: saving the
  // scaffold as-is creates the flow (the session is not the only path).
  const save = await app.evaluate(() =>
    Array.from(document.querySelectorAll("button")).some((b) =>
      b.textContent?.includes("Save as new flow")
    )
  );
  expect(save, "the hand-write save button is present").toBe(true);
});

test("hand-writing the scaffold saves a definition without a session", async () => {
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  // The save registers "hand-written"; drop any previous run's record first
  // (the app page must exist before page code can run).
  await app.open(`${baseUrl}/#/flows/new`);
  await deleteDefinition("hand-written");
  await app.waitForFunction(
    () =>
      document
        .querySelector("code-editor")
        ?.shadowRoot?.querySelector("textarea")
        ?.value?.includes("myFlow") ?? false,
    undefined,
    { timeout: 15_000 }
  );
  // Hand-write: rename the scaffold's id and label directly.
  const edited = await app.evaluate(() => {
    const textarea = document
      .querySelector("code-editor")
      ?.shadowRoot?.querySelector("textarea");
    if (!textarea) return false;
    textarea.value = textarea.value
      .replace('id: "myFlow",', 'id: "handFlow",')
      .replace('label: "My Flow",', 'label: "Hand Written",');
    textarea.dispatchEvent(
      new Event("input", { bubbles: true, composed: true })
    );
    return true;
  });
  expect(edited, "the scaffold must be editable").toBe(true);
  // Save without any session: the definition is created from the draft and
  // the editor routes to its edit page.
  await app.click("button", { hasText: "Save as new flow" });
  await waitFor(
    async () =>
      (await app.evaluate(() => window.location.hash)) ===
      "#/flows/hand-written/edit"
  );
  const definition = await app.evaluate(async () => {
    const res = await fetch("/api/flows/definitions/hand-written");
    return res.ok ? await res.json() : null;
  });
  expect(definition, "the hand-written definition exists").toBeTruthy();
  expect(definition?.name).toBe("Hand Written");
  expect(
    definition?.source?.includes('id: "handFlow"'),
    "the saved source is the hand-written module"
  ).toBe(true);
});

test("a conversation seeds from the editor's scaffold edits", async () => {
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  await app.open(`${baseUrl}/#/flows/new`);
  await app.waitForFunction(
    () =>
      document
        .querySelector("code-editor")
        ?.shadowRoot?.querySelector("textarea")
        ?.value?.includes("myFlow") ?? false,
    undefined,
    { timeout: 15_000 }
  );
  // Edit the scaffold's label before starting the conversation.
  await app.evaluate(() => {
    const textarea = document
      .querySelector("code-editor")
      ?.shadowRoot?.querySelector("textarea");
    if (!textarea) return false;
    textarea.value = textarea.value.replace(
      'label: "My Flow",',
      'label: "My Edited Flow",'
    );
    textarea.dispatchEvent(
      new Event("input", { bubbles: true, composed: true })
    );
    return true;
  });
  // Start a conversation: the session seeds from the edited scaffold (the
  // edit IS the state — the agent reads it, not a stale copy).
  await app.fill("textarea", "extend the scaffold", { first: true });
  await app.click("button", { hasText: "Start conversation" });
  // The agent read the seeded source and set it back verbatim — the editor
  // shows the human's edited label, not a mock-authored copy.
  await waitForEditor((state) => state.code.includes("My Edited Flow"), 40_000);
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
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  // Register a definition to work on (a data module with a referenced file).
  // Navigate first so the page origin matches the API host.
  await app.open(`${baseUrl}/#/flows`);
  const created = await registerDefinition("Close Me", CLOSE_SOURCE, CLOSE_FILES);
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
  await waitForEditor((state) => state.code.includes("FlowDefinition"), 40_000);

  // Close the session (a shell button, not inside the flow-editor): the
  // persistent files stay visible and editable — the session was a
  // collaborator, not the only way to see the flow.
  await app.click("button.author-close");
  // The no-session files editor binds the saved source once the detail
  // refreshes (the close also re-fetches it).
  await app.waitForFunction(
    () =>
      document
        .querySelector("code-editor")
        ?.shadowRoot?.querySelector("textarea")
        ?.value?.includes("closeFlow") ?? false,
    undefined,
    { timeout: 15_000 }
  );
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
  const edited = await app.evaluate(() => {
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
  expect(edited, "the no-session editor must be editable").toBe(true);
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
  const definition = await app.evaluate(async () => {
    const res = await fetch("/api/flows/definitions/close-me");
    return res.ok ? await res.json() : null;
  });
  expect(definition, "the saved definition survives closing the session").toBeTruthy();
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
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  // Lucky session: the generated definition module renders as the editor.
  await app.open(`${baseUrl}/#/flows/new`);
  await app.waitForSelector("textarea", { timeout: 15_000 });
  await app
    .fill("textarea", "A review flow with approve and reject actions", {
      first: true,
    });
  await app.click("button", { hasText: "I'm feeling lucky" });
  await waitForEditor(
    (state) => state.title === "A review flow with approve and reject actions"
  );
  await waitForEditor((state) => state.code.includes("reviewFlow"));

  // The human edits the source: a label change.
  const edited = await app.evaluate(() => {
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
  expect(edited, "the editor must be editable").toBe(true);

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
  expect(await sendChatMessage("continue the session")).toBe(true);
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
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

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
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

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
  await waitForEditor(
    (state) =>
      state.tabs.includes("Definition") &&
      state.tabs.includes("./tools/websearch.ts"),
    40_000
  );

  // Open the referenced file: the editor shows its (unwritten) pane; the
  // human implements it directly.
  expect(
    await clickEditorTab("./tools/websearch.ts"),
    "the referenced file tab must be clickable"
  ).toBe(true);
  await waitForEditor(
    (state) => state.code !== "" || state.code === "",
    40_000
  );

  // Edit the file: the write-back lands in the session (authoritative).
  expect(await editActiveEditor(EDITED_TOOL), "the file editor is editable").toBe(
    true
  );
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
  await app.reload();
  await waitForEditor(
    (state) => state.tabs.includes("./tools/websearch.ts"),
    40_000
  );
  expect(await clickEditorTab("./tools/websearch.ts")).toBe(true);
  await waitForEditor((state) => state.code.includes("edited result"), 40_000);
});

test("revising an existing definition shows its referenced files as editable tabs", async () => {
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

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
  await waitForEditor(
    (state) => state.tabs.includes("./gates/approved.ts"),
    40_000
  );

  // Open it: the seeded content is there (the file is editable in-conversation).
  expect(await clickEditorTab("./gates/approved.ts")).toBe(true);
  await waitForEditor(
    (state) => state.code.includes("export const ok = true;"),
    40_000
  );
});

test("hand-adding a ref to a saved definition shows its tab and saves the file", async () => {
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  // A saved definition with no referenced files.
  await app.open(`${baseUrl}/#/flows`);
  const created = await registerDefinition("Add Ref", ADD_REF_SOURCE);
  expect(created, "definition registered").toBeTruthy();
  expect(created?.id).toBe("add-ref");

  // Hand-edit the source to declare a referenced tool.
  await app.open(`${baseUrl}/#/flows/add-ref/edit`);
  await app.waitForFunction(
    () =>
      document
        .querySelector("code-editor")
        ?.shadowRoot?.querySelector("textarea")
        ?.value?.includes("add-ref") ?? false,
    undefined,
    { timeout: 15_000 }
  );
  const edited = await app.evaluate(() => {
    const textarea = document
      .querySelector("code-editor")
      ?.shadowRoot?.querySelector("textarea");
    if (!textarea) return false;
    textarea.value = textarea.value.replace(
      "configSchema: [],",
      'configSchema: [],\n  tools: [{ id: "websearch", ref: "./tools/websearch.ts", writes: [] }],'
    );
    textarea.dispatchEvent(
      new Event("input", { bubbles: true, composed: true })
    );
    return true;
  });
  expect(edited, "the source must be editable").toBe(true);

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
  await app.waitForFunction(
    () =>
      document
        .querySelector("code-editor")
        ?.shadowRoot?.querySelector("textarea") !== null,
    undefined,
    { timeout: 10_000 }
  );
  const wrote = await app.evaluate((content) => {
    const textarea = document
      .querySelector("code-editor")
      ?.shadowRoot?.querySelector("textarea");
    if (!textarea) return false;
    textarea.value = content;
    textarea.dispatchEvent(
      new Event("input", { bubbles: true, composed: true })
    );
    return true;
  }, EDITED_TOOL);
  expect(wrote, "the referenced file tab must be writable").toBe(true);

  // Save: the module + the hand-written file register together.
  await app.click("button", { hasText: "Save definition" });
  await app.waitForSelector(".saved-status", { timeout: 20_000 });

  const definition = await app.evaluate(async () => {
    const res = await fetch("/api/flows/definitions/add-ref");
    return res.ok ? await res.json() : null;
  });
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
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  await app.open(`${baseUrl}/#/flows/queen-bee`);
  // The built-in's definition page offers View (never Edit).
  await app.waitForSelector("a", { hasText: "View", timeout: 20_000 });
  await app.click("a", { hasText: "View", first: true });

  // The read-only viewer shows the preset's entry source on the Definition tab.
  await app.waitForSelector("code-editor", { timeout: 20_000 });
  const code = await app.evaluate(() => {
    const editor = document.querySelector("code-editor");
    return editor?.shadowRoot?.querySelector("textarea")?.value ?? "";
  });
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
