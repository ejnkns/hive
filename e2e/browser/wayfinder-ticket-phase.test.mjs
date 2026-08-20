// Wayfinder ticket phase end-to-end: chart → add ticket → graduate → claim
// (research) → resolve to closed → start build. Drives the real browser + mock
// provider through the flow-component surface (the flow-level custom view) and
// the served ticket card, beyond the creation/charting e2e.
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL via
// `inject`), and the app runs in a second page of the same browser, driven
// through the shared `app` wrapper (e2e/support/browser-app.mjs).

import { expect, inject, onTestFailed, test } from "vitest";
import { app } from "../support/browser-app.mjs";

const baseUrl = inject("baseUrl");

// Clicks a button whose text equals `label`, across nested shadow roots.
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

// Whether an element with the class AND text exists deep in the shadow tree.
async function deepHasText(className, text, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await app.evaluate(
      ({ className, text }) => {
        const walk = (root) => {
          for (const el of root.querySelectorAll(`.${className}`)) {
            if (el.textContent?.includes(text)) return true;
          }
          for (const el of root.querySelectorAll("*")) {
            if (el.shadowRoot && walk(el.shadowRoot)) return true;
          }
          return false;
        };
        const host = document.querySelector("workflow-instances");
        return walk(host?.shadowRoot ?? document);
      },
      { className, text }
    );
    if (found) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Clicks the first element with the class, across nested shadow roots.
async function clickClass(className, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await app.evaluate((className) => {
      const walk = (root) => {
        for (const el of root.querySelectorAll(`.${className}`)) {
          el.dispatchEvent(
            new MouseEvent("click", { bubbles: true, composed: true })
          );
          return true;
        }
        for (const el of root.querySelectorAll("*")) {
          if (el.shadowRoot && walk(el.shadowRoot)) return true;
        }
        return false;
      };
      const host = document.querySelector("workflow-instances");
      return walk(host?.shadowRoot ?? document);
    }, className);
    if (clicked) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Submits the flow-action create form (the shared Svelte dialog).
async function submitFlowActionForm() {
  await app.waitForSelector(".dialog-actions button", { timeout: 10_000 });
  await app.click(".dialog-actions button", { hasText: "Run", first: true });
}

test("wayfinder ticket phase: chart → add research ticket → graduate → claim → closed → start build", async () => {
  // The flow name is unique per run so watch-mode re-runs never collide
  // (instance names are unique within a definition; the server 409s on dupes).
  const flowName = `ticket-check-${Date.now()}`;
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  await app.open(`${baseUrl}/#/flows`);
  await app.waitForTimeout(800);

  const created = await app.evaluate(
    async (config) => {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definitionId: "wayfinder", config }),
      });
      return res.json();
    },
    { name: flowName, destination: "Pick the editor's storage layer" }
  );
  expect(created.ok, JSON.stringify(created)).toBe(true);

  await app.open(`${baseUrl}/#/flows/wayfinder/${flowName}`);
  await app.waitForSelector("workflow-instances", { timeout: 30_000 });
  await app.waitForTimeout(2_000);

  // The table renders the map card, and the map view drills in and back.
  expect(
    await deepHasText("open-map", "Open the map view"),
    "the table shows the map card"
  ).toBe(true);
  expect(await clickClass("open-map"), "open the map view from the map card").toBe(
    true
  );
  expect(
    await deepHasText("back-link", "Back to the table"),
    "the map view has a back link"
  ).toBe(true);
  expect(await clickClass("back-link"), "return to the table").toBe(true);

  // Chart: the naming session is agent-initiating (the mock answers it), so
  // Done → frontier, then Done → charted.
  expect(await waitAndClick("Done"), "naming session Done").toBe(true);
  await app.waitForTimeout(4_000);
  expect(await waitAndClick("Done"), "frontier session Done").toBe(true);
  await app.waitForTimeout(2_000);

  // Add a research ticket through the flow-action create form.
  await app.click("button", { hasText: "Add ticket", first: true });
  await app.waitForSelector("#cf-title", { timeout: 10_000 });
  await app.fill("#cf-title", "Choose the store");
  await app.fill("#cf-question", "localStorage or IndexedDB?");
  await app.selectOption("#cf-type", "research");
  await submitFlowActionForm();

  // The ticket lands in the fog tray (normalize runs), highlighted as needing
  // clarity, then the graduate action opens.
  expect(
    await deepHasText("fog-card", "Choose the store"),
    "the fog tray shows the new ticket"
  ).toBe(true);
  expect(await waitAndClick("Graduate to ready"), "graduate the fog ticket").toBe(
    true
  );

  // The ready ticket sits in the briefing deck with its research stamp; claim
  // it, and the one-shot research agent resolves it (the mock completes it),
  // then assemble closes the ticket.
  expect(
    await deepHasText("stamp", "research"),
    "the briefing deck stamps the ready ticket research"
  ).toBe(true);
  expect(await waitAndClick("Claim for research"), "claim the ticket").toBe(
    true
  );

  // Once the ticket closes the map is clear, so Start build becomes available.
  expect(
    await waitAndClick("Start build", 30_000),
    "start build after the frontier cleared"
  ).toBe(true);
  await submitFlowActionForm();

  // The build workflow starts in its specing state; the depot shows its crate.
  expect(
    await deepHasText("crate", "specing"),
    "the depot shows the specing build crate"
  ).toBe(true);
});
