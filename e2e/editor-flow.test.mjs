// The flow editor as a rendered flow instantiation, end to end: a lucky-mode
// authoring session renders as a flow instance (the built-in flow-editor
// composing header, chat, tokenized preview, and actions), and its save
// action registers the definition through the shell-side REST path. One
// session, three scripted model calls — bounded cost.
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

// The flow-editor's live state: header title, code-pane text, and every
// visible button, across nested shadow roots.
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
    const title =
      shadow.querySelector(".editor-title")?.textContent?.trim() ?? null;
    const code = shadow.querySelector(".code")?.textContent ?? "";
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
    return { title, code, buttons };
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
// tree (the flow-editor's action row renders there).
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

test("authoring session renders as the flow editor and saves the definition", async () => {
  // Definition editor (new definition): start a lucky session.
  await page.goto(`${baseUrl}/#/flows/new`);
  await page.waitForSelector("textarea", { timeout: 15_000 });
  await page
    .locator("textarea")
    .first()
    .fill("A review flow with approve and reject actions");
  await page.locator("button", { hasText: "I'm feeling lucky" }).click();

  // The session renders as a flow instance: the flow-editor's header carries
  // the user's prompt.
  await waitForEditor(
    (state) => state.title === "A review flow with approve and reject actions"
  );

  // The agent's set_flow_spec call lands previewSource — the tokenized code
  // pane shows the rendered definition.
  const withPreview = await waitForEditor((state) =>
    state.code.includes("reviewFlow")
  );
  assert.ok(
    withPreview.code.includes("defineWorkflow"),
    "the code pane renders the tokenized previewSource"
  );

  // The action row exposes validate/save (declared on the drafting state);
  // save registers the definition through the shell-side REST path.
  assert.ok(
    await clickEditorButton("Save definition"),
    "the save action is available and clicked"
  );

  // A clean save navigates to the registered definition's page.
  await page.waitForFunction(
    () => window.location.hash.startsWith("#/flows/review-flow"),
    { timeout: 20_000 }
  );
  await page.waitForSelector("text=Review Flow", { timeout: 15_000 });
  assert.ok(
    await page.locator("button", { hasText: "New instance" }).count(),
    "the definition page lists the new-instance affordance"
  );

  // The registered definition is servable by id with the gate-clean source.
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
