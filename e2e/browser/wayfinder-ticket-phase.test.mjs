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

import { expect, inject, test } from "vitest";
import { app } from "../support/browser-app.mjs";
import {
  captureFailureScreenshot,
  submitFlowActionForm,
} from "../support/flows.mjs";

const baseUrl = inject("baseUrl");

test("wayfinder ticket phase: chart → add research ticket → graduate → claim → closed → start build", async () => {
  const flowName = `ticket-check-${Date.now()}`;
  captureFailureScreenshot();

  await app.open(`${baseUrl}/#/flows`);
  const created = await app.createFlow("wayfinder", {
    name: flowName,
    destination: "Pick the editor's storage layer",
    // Bind the flow to the per-run temp project so the persisted-output seam
    // (decisions/, map.md) resolves to isolated files that teardown removes.
    basePath: inject("projectPath"),
  });
  expect(created.ok, JSON.stringify(created)).toBe(true);

  await app.open(`${baseUrl}/#/flows/wayfinder/${flowName}`);
  await expect
    .poll(() => app.isVisible("workflow-instances"), { timeout: 30_000 })
    .toBe(true);

  // A newly created flow is an empty expedition: the Base Camp empty state
  // presents the charting session card (whose actions drive the charting).
  await app.waitForSelector(".base-panel", { timeout: 30_000 });

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

  // The ticket landing makes the expedition populated: the map-first shell
  // with its HUD takes over. Verify the surface, then switch to the table
  // where the fog tray interactions below live.
  await app.waitForSelector(".map-layout", { timeout: 30_000 });
  await app.click(".view-toggle button", { hasText: "Table", first: true });

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

  // The journal drills into the closed ticket's persisted decision record:
  // assemble_resolution wrote decisions/<ticketId>.md, the snapshot shipped it
  // as persistedOutputDirs, and clicking the entry renders it as markdown.
  await app.waitForSelector(".journal .entry", {
    hasText: "Choose the store",
    timeout: 30_000,
  });
  await app.click(".journal .entry", {
    hasText: "Choose the store",
    first: true,
  });
  await app.waitForSelector(".journal .decision markdown-view .markdown", {
    timeout: 10_000,
  });
  const recordText =
    (await app.textContent(".journal .decision markdown-view .markdown")) ?? "";
  expect(
    recordText,
    "the decision record renders the research findings"
  ).toContain("IndexedDB is the right store");
  expect(recordText, "the record carries the research gist").toContain(
    "Research report on"
  );
});
