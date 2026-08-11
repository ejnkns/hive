// The flow editor as a rendered flow instantiation, end to end: a lucky-mode
// authoring session renders as a flow instance (the built-in flow-editor
// composing header, chat, editable definition source, and save), and the
// co-editing loop works — hand edits write back (spec diverged), the agent's
// spec tools are gated and it proposes in chat, and discard hands the
// definition back. One session, a bounded set of scripted model calls.
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
    return { title, code, saved, buttons };
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
// the library list does not include it — fetch by the stored id).
async function sessionState() {
  return page.evaluate(async () => {
    const stored = localStorage.getItem("hive:author:new");
    if (!stored) return null;
    const res = await fetch(`/api/flows/${encodeURIComponent(stored)}`);
    if (!res.ok) return null;
    const flow = await res.json();
    return flow.instances?.[0]?.state ?? null;
  });
}

async function waitForSessionState(predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await sessionState();
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
  // the user's prompt, and the editable editor shows the generated source.
  await waitForEditor(
    (state) => state.title === "A review flow with approve and reject actions"
  );
  await waitForEditor((state) => state.code.includes("reviewFlow"));
  assert.ok(
    await editDefinitionSource("export const flow = {}; // manual tweak"),
    "the editable source is present"
  );

  // The write-back lands: the session source is the manual text, diverged.
  await waitForSessionState(
    (state) =>
      typeof state.workflowInstanceState?.source === "string" &&
      state.workflowInstanceState.source.includes("manual tweak") &&
      state.workflowInstanceState.specDiverged === true
  );

  // Ask the agent to continue: its set_flow_spec is gated (manual edits) and
  // it proposes in chat instead of overwriting.
  assert.ok(await sendChatMessage("please add a reject action"));
  await waitForSessionState((state) => {
    const messages = state.runningTaskContext?.messages ?? [];
    return messages.some(
      (m) =>
        m.role === "assistant" &&
        typeof m.content === "string" &&
        m.content.includes("by hand") &&
        m.content.includes("frozen")
    );
  }, 40_000);

  // Discard hands the definition back — the divergence clears.
  assert.ok(await clickEditorButton("Discard edits"));
  await waitForSessionState(
    (state) => state.workflowInstanceState?.specDiverged === false
  );

  // Regenerate: the agent's spec tools work again and the editor adopts the
  // regenerated source (the manual tweak is gone).
  assert.ok(await sendChatMessage("regenerate the definition"));
  await waitForEditor(
    (state) =>
      state.code.includes("reviewFlow") &&
      !state.code.includes("manual tweak"),
    40_000
  );

  // Save registers the definition synchronously; the flow-editor reflects it.
  assert.ok(
    await clickEditorButton("Save definition"),
    "the save button is available and clicked"
  );
  await waitForEditor((state) => state.saved.includes("review-flow"));
  assert.equal(
    await page.evaluate(() => window.location.hash),
    "#/flows/new",
    "save keeps the user in the session"
  );

  const definition = await page.evaluate(async () => {
    const res = await fetch("/api/flows/definitions/review-flow");
    return res.ok ? await res.json() : null;
  });
  assert.equal(definition?.name, "Review Flow");
  assert.ok(
    definition?.source?.includes("defineWorkflow"),
    "the saved definition source is the generated TypeScript"
  );
});
