// Regression: the served wayfinder components must survive a page reload. The
// reload race (LitFlowHost disposes an in-flight load whose stale cleanup used
// to clobber the newer load's registration) lost the custom views on reload.
// Open the flow (the charting session auto-starts), reload, and verify the
// expedition map's custom chat still renders.
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL via
// `inject`), and the app runs in a second page of the same browser, driven
// through the custom commands in e2e/app-commands.ts. Standard Playwright
// selectors pierce the app's nested Lit shadow DOM; `expect.poll` retries the
// command checks until they settle — no hand-rolled walkers, no sleeps.

import { expect, inject, onTestFailed, test } from "vitest";
import { commands } from "vitest/browser";

const baseUrl = inject("baseUrl");

test("charting session and expedition map survive reload", async () => {
  // The flow name is unique per run so watch-mode re-runs never collide
  // (instance names are unique within a definition; the server 409s on dupes).
  const flowName = `session-check-${Date.now()}`;
  onTestFailed(async () => {
    const shot = await commands.appScreenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  await commands.openApp(`${baseUrl}/#/flows`);
  const created = await commands.createFlow("wayfinder", {
    name: flowName,
    destination: "A spec to hand off",
  });
  expect(created.ok).toBe(true);

  // Opening the flow starts the charting session: the charting workflow's
  // initial state is `naming`, whose interactive session opens seeded with the
  // destination (the old harness's "Start charting" click was a silent no-op —
  // the flow auto-starts). Wait for the session and the expedition map.
  await commands.openApp(`${baseUrl}/#/flows/wayfinder/${flowName}`);
  await expect
    .poll(() => commands.appIsVisible("workflow-instances"), {
      timeout: 30_000,
    })
    .toBe(true);
  await expect
    .poll(
      () => commands.appIsVisible('input[placeholder="Type a message..."]'),
      {
        timeout: 30_000,
      }
    )
    .toBe(true);
  await expect
    .poll(() => commands.appCount(".session-label"), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() => commands.appIsVisible(".expedition"), { timeout: 30_000 })
    .toBe(true);

  // Reload and verify the same state survives: the session chat input, the
  // session state label, and the expedition map are all back.
  await commands.appReload();
  await expect
    .poll(() => commands.appIsVisible("workflow-instances"), {
      timeout: 30_000,
    })
    .toBe(true);
  await expect
    .poll(() => commands.appIsVisible(".expedition"), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(() => commands.appCount(".session-label"), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(
      () => commands.appIsVisible('input[placeholder="Type a message..."]'),
      {
        timeout: 30_000,
      }
    )
    .toBe(true);
});
