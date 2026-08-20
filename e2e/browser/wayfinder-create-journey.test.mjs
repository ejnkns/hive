// The wayfinder creation → charting journey, end to end:
// 1. Creating with a destination seeds it into the charting instance.
// 2. The charting session STARTS on submission (no "Start charting" click) —
//    the expedition map shows the naming chat with the destination as the
//    opening user message.
// 3. Reloading preserves it all.
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL via
// `inject`), and the app runs in a second page of the same browser, driven
// through the shared `app` wrapper (e2e/support/browser-app.mjs). Playwright
// CSS selectors pierce the app's nested Lit shadow DOM, so every check is a
// direct selector with auto-wait (`expect.poll` / `app.waitForSelector`) — no
// shadow-DOM walkers, no sleeps (the old snapshot-deep-equal after a fixed
// delay is now re-asserted on the observable DOM state after reload).

import { expect, inject, onTestFailed, test } from "vitest";
import { app } from "../support/browser-app.mjs";

const baseUrl = inject("baseUrl");

test("creating a wayfinder instance starts the charting session with the destination", async () => {
  // The flow name is unique per run so watch-mode re-runs never collide
  // (instance names are unique within a definition; the server 409s on dupes).
  const flowName = `expedition-check-${Date.now()}`;
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  await app.open(`${baseUrl}/#/flows`);
  const created = await app.createFlow("wayfinder", {
    name: flowName,
    destination: "A spec for the routing layer",
  });
  expect(created.ok, JSON.stringify(created)).toBe(true);

  await app.open(`${baseUrl}/#/flows/wayfinder/${flowName}`);
  await expect
    .poll(() => app.isVisible("workflow-instances"), { timeout: 30_000 })
    .toBe(true);

  // The creation destination lands on the map.
  await app.waitForSelector(".dest-note", {
    hasText: "routing layer",
    timeout: 30_000,
  });

  // The charting session started on submission — the naming chat is live
  // (no "Start charting" click needed), with the phase named in its header.
  await app.waitForSelector(".session-label", {
    hasText: "Naming",
    timeout: 30_000,
  });
  await expect
    .poll(() => app.count('input[placeholder="Type a message..."]'), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  // A single active workflow: no overview bar (it would be redundant).
  expect(await app.count(".overview"), "no overview for a single workflow").toBe(
    0
  );

  // Reload preserves it all: the destination, the live naming session, and
  // the single-workflow layout all come back (each re-asserted with auto-wait
  // instead of the old fixed-delay snapshot comparison).
  await app.reload();
  await expect
    .poll(() => app.isVisible("workflow-instances"), { timeout: 30_000 })
    .toBe(true);
  await app.waitForSelector(".dest-note", {
    hasText: "routing layer",
    timeout: 30_000,
  });
  await app.waitForSelector(".session-label", {
    hasText: "Naming",
    timeout: 30_000,
  });
  await expect
    .poll(() => app.count('input[placeholder="Type a message..."]'), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  expect(await app.count(".overview"), "no overview after reload").toBe(0);
});
