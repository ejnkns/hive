// Queen-bee card lifecycle end-to-end in a real browser against the real
// server (mock model provider). This is the "all layers meet" test the manual
// pass was required for: real persistence, real git worktrees, the real Lit
// rendering surface, and the real browser's custom-element constraints. It
// guards the browser/WS/schema seams that unit and component tests cannot.
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL and the
// fixture project path via `inject`), and the app runs in a second page of the
// same browser, driven through the shared `app` wrapper
// (e2e/support/browser-app.mjs).

import { expect, inject, onTestFailed, test } from "vitest";
import { app } from "../support/browser-app.mjs";

const baseUrl = inject("baseUrl");
const projectPath = inject("projectPath");

// The live DOM state of one workflow section: card titles + every visible
// button text, across nested shadow roots.
async function sectionState(label) {
  return app.evaluate((label) => {
    const walkButtons = (root) => {
      const buttons = [];
      for (const el of root.querySelectorAll("button")) {
        const t = el.textContent?.trim();
        if (t && !buttons.includes(t)) buttons.push(t);
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) buttons.push(...walkButtons(el.shadowRoot));
      }
      return buttons;
    };
    const host = document.querySelector("workflow-instances");
    const shadow = host?.shadowRoot;
    const flow = Array.from(shadow?.querySelectorAll(".flow") ?? []).find(
      (f) => f.querySelector(".flow-label")?.textContent === label
    );
    if (!flow) return null;
    const titleOf = (el) => {
      const itemHeader = el?.shadowRoot?.querySelector("item-header");
      return (
        itemHeader?.shadowRoot?.querySelector(".title")?.textContent ?? null
      );
    };
    const cards = Array.from(flow.querySelectorAll("dynamic-element-host")).map(
      (hostEl) =>
        titleOf(hostEl.shadowRoot?.querySelector(".mount > *")) ?? null
    );
    return { cards, buttons: walkButtons(shadow ?? document) };
  }, label);
}

async function waitForSection(label, predicate, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await sectionState(label);
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// Waits until a button with the exact label is visible (across nested shadow
// roots), then clicks it. Returns false if it never appears.
async function waitAndClick(buttonLabel, timeoutMs = 40_000) {
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

// Sends a chat message to the interactive session in a section's card
// (startOnUserInput sessions poll for their input across turns).
async function replyToChat(text, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sent = await app.evaluate((text) => {
      const walk = (root) => {
        const session = root.querySelector("chat-session");
        if (session?.shadowRoot) {
          const input = session.shadowRoot.querySelector("input");
          if (input) return { session, input };
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
      } else {
        found.input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            composed: true,
          })
        );
      }
      return true;
    }, text);
    if (sent) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

test("queen-bee card lifecycle: onboarding → requirements → plan → card → done", async () => {
  // The flow name is unique per run so watch-mode re-runs never collide
  // (instance names are unique within a definition; the server 409s on dupes).
  const flowName = `e2e-project-${Date.now()}`;
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  // Flows library lists the built-ins.
  await app.open(`${baseUrl}/#/flows`);
  await app.waitForSelector("text=Queen Bee", { timeout: 15_000 });
  expect(await app.count("text=Wayfinder")).toBe(1);

  // Create a flow bound to the fixture project.
  await app.open(`${baseUrl}/#/flows/queen-bee/new`);
  await app.waitForSelector("input", { timeout: 15_000 });
  await app.fill("input", flowName, { first: true });
  await app.fill("input", projectPath, { nth: 1 });
  await app.click("button", { hasText: "Create instance", first: true });
  await app.waitForSelector(".flow-header", { timeout: 20_000 });

  // Onboarding completes on its own (operations only).
  await waitForSection("Onboarding", () => true);
  await waitForSection("Requirements", (s) => s.cards.length === 1);

  // Requirements session: start, answer the agent's clarifying question
  // (startOnUserInput — the first reply starts the agent, which explores and
  // asks; the second reply answers, the draft lands, REQUIREMENTS_COMPLETE).
  expect(
    await waitAndClick("Start requirements session"),
    "start requirements session"
  ).toBe(true);
  expect(
    await replyToChat("yes, the greeting is deterministic"),
    "chat input appeared and reply sent"
  ).toBe(true);
  await app.waitForTimeout(6_000); // agent explores, then asks
  expect(await replyToChat("yes, exactly one deterministic greeting")).toBe(
    true
  );

  // Requirements → complete → planning (planner proposes) → planned → accept.
  for (const step of [
    "Submit for planning",
    "Accept proposal",
    "Accept all and create cards",
  ]) {
    expect(await waitAndClick(step), `${step} available and clicked`).toBe(true);
    if (step !== "Accept all and create cards") {
      await app.waitForTimeout(8_000); // planner runs after submit
    }
  }

  // The edge fans the plan out into a cards instance (ready, runnable).
  const cards = await waitForSection("Cards", (s) => s.cards.length === 1);
  expect(cards, "cards section appears with the planned card").toBeTruthy();
  expect(
    cards.buttons.includes("Run Worker Agent"),
    "the ready card exposes Run Worker Agent"
  ).toBe(true);

  // Run the worker (mock writes + commits + submits) → validation → review →
  // the reviewer approves → accept merges to done.
  expect(await waitAndClick("Run Worker Agent")).toBe(true);
  await app.waitForTimeout(2_000);
  const workerChat = await app.evaluate(() => {
    const host = document.querySelector("workflow-instances");
    const walk = (root) => {
      let inputs = 0;
      inputs += root.querySelectorAll("chat-session input").length;
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) inputs += walk(el.shadowRoot);
      }
      return inputs;
    };
    return walk(host?.shadowRoot ?? document);
  });
  expect(
    workerChat,
    "the one-shot worker chat is read-only (no input) — the requirements chat had one"
  ).toBe(0);
  // KNOWN FAILURE (ticket 08/09, see docs/known-issues.md): the reviewer never
  // approves, so "Accept work" never appears and this assertion fails.
  expect(
    await waitAndClick("Accept work", 60_000),
    "reviewer approved and accept became available"
  ).toBe(true);
  await waitForSection(
    "Cards",
    (s) => s.cards.length === 1 && s.buttons.length > 0,
    30_000
  );
  await app.waitForTimeout(3_000);

  // Add an idea: the served idea-card (a served-at-runtime custom component)
  // must load, register, and render live — the end-to-end guard for the
  // browser custom-element + re-render bugs that component tests could not
  // catch (the demo card vanished until the loader registered classes and the
  // host re-rendered after the async load).
  await app.click("button", { hasText: "Add idea", first: true });
  await app.waitForSelector(".action-form input", { timeout: 10_000 });
  await app.fill(".action-form input", "A great idea", { first: true });
  await app.click(".dialog-actions button", { hasText: "Run", first: true });
  await app.waitForSelector(".idea-title", { timeout: 15_000 });
  const ideaTitle = await app.textContent(".idea-title");
  expect(ideaTitle?.trim(), "the served idea card renders the idea title").toBe(
    "A great idea"
  );

  // The done card carries the plan's title.
  const done = await sectionState("Cards");
  expect(
    done.cards.some((title) => (title ?? "").includes("deterministic greeting")),
    `done card title present (${JSON.stringify(done.cards)})`
  ).toBe(true);
});
