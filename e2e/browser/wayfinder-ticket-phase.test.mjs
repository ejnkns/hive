// Wayfinder ticket phase end-to-end: chart → add ticket → graduate → claim
// (research) → resolve to closed → start build. Drives the real browser + mock
// provider through the flow-component surface (the flow-level custom view) and
// the served ticket card, beyond the creation/charting e2e.
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL via
// `inject`), and the app runs in a second page of the same browser, driven
// through the shared `app` wrapper (e2e/support/browser-app.mjs). Playwright
// CSS selectors pierce the app's nested Lit shadow DOM, so buttons and cards
// deep in the served component are addressed directly and clicked with
// auto-wait (`app.click` / `app.waitForSelector`) — no hand-rolled shadow-DOM
// walkers, no sleeps. The session-to-session transitions (naming Done →
// frontier Done) retry on the observable DOM state instead of fixed delays.

import { expect, inject, onTestFailed, test } from "vitest";
import { app } from "../support/browser-app.mjs";

const baseUrl = inject("baseUrl");

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
  const created = await app.createFlow("wayfinder", {
    name: flowName,
    destination: "Pick the editor's storage layer",
  });
  expect(created.ok, JSON.stringify(created)).toBe(true);

  await app.open(`${baseUrl}/#/flows/wayfinder/${flowName}`);
  await expect
    .poll(() => app.isVisible("workflow-instances"), { timeout: 30_000 })
    .toBe(true);

  // The table renders the map card, and the map view drills in and back.
  await app.waitForSelector(".open-map", {
    hasText: "Open the map view",
    timeout: 30_000,
  });
  await app.click(".open-map", { first: true });
  await app.waitForSelector(".back-link", {
    hasText: "Back to the table",
    timeout: 30_000,
  });
  await app.click(".back-link", { first: true });

  // Chart: the naming session is agent-initiating (the mock answers it), so
  // Done → frontier, then Done → charted. Each click auto-waits for its
  // session's Done to be live — the old fixed sleeps between sessions are
  // replaced by waiting on the observable DOM state.
  await app.click("button", { hasText: "Done" });
  await app.click("button", { hasText: "Done" });

  // Add a research ticket through the flow-action create form.
  await app.click("button", { hasText: "Add ticket", first: true });
  await app.waitForSelector("#cf-title", { timeout: 10_000 });
  await app.fill("#cf-title", "Choose the store");
  await app.fill("#cf-question", "localStorage or IndexedDB?");
  await app.selectOption("#cf-type", "research");
  await submitFlowActionForm();

  // The ticket lands in the fog tray (normalize runs), highlighted as needing
  // clarity, then the graduate action opens.
  await app.waitForSelector(".fog-card", {
    hasText: "Choose the store",
    timeout: 30_000,
  });
  await app.click("button", { hasText: "Graduate to ready" });

  // The ready ticket sits in the briefing deck with its research stamp; claim
  // it, and the one-shot research agent resolves it (the mock completes it),
  // then assemble closes the ticket.
  await app.waitForSelector(".stamp", {
    hasText: "research",
    timeout: 30_000,
  });
  await app.click("button", { hasText: "Claim for research" });

  // Once the ticket closes the map is clear, so Start build becomes available
  // (auto-waits until the flow action's gate passes).
  await app.click("button", { hasText: "Start build" });
  await submitFlowActionForm();

  // The build workflow starts in its specing state; the depot shows its crate.
  await app.waitForSelector(".crate", {
    hasText: "specing",
    timeout: 30_000,
  });
});
