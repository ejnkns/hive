// Wayfinder interactions end-to-end: two-way hover sync between table cards
// and mini-map markers, click-to-focus, and drag-to-reorder in the fog tray.
// Drives the real browser + mock provider through the flow-component surface,
// using the same dispatched-event path the component tests use (a real
// pointer drag proved flaky for HTML5 drag-and-drop).
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL via
// `inject`), and the app runs in a second page of the same browser, driven
// through the shared `app` wrapper (e2e/support/browser-app.mjs). Playwright
// CSS selectors pierce the app's nested Lit shadow DOM, so the tray checks and
// the hover sync are direct selectors with auto-waiting assertions — no
// hand-rolled shadow-DOM walkers, no sleeps.
//
// The ONE justified exception is the fog drag-to-reorder: HTML5 drag is
// dispatched (dragstart/dragover/drop/dragend) on real geometry inside the
// app page — a real pointer drag proved flaky — implemented once in the
// shared dragFogCardAbove helper (flows.mjs). The hover sync uses dispatched
// mouseenter/mouseleave on the real elements (the same synthetic path the
// component tests use; a real pointer hover is fragile on the piled cards'
// overlap).

import { expect, inject, test } from "vitest";
import { app } from "../support/browser-app.mjs";
import {
  captureFailureScreenshot,
  dragFogCardAbove,
  submitFlowActionForm,
} from "../support/flows.mjs";

const baseUrl = inject("baseUrl");

test("wayfinder interactions: hover sync card<->marker and fog drag reorder", async () => {
  const flowName = `interaction-check-${Date.now()}`;
  captureFailureScreenshot();

  await app.open(`${baseUrl}/#/flows`);
  const created = await app.createFlow("wayfinder", {
    name: flowName,
    destination: "Pick the editor's storage layer",
    basePath: inject("projectPath"),
  });
  expect(created.ok, JSON.stringify(created)).toBe(true);

  await app.open(`${baseUrl}/#/flows/wayfinder/${flowName}`);
  await expect
    .poll(() => app.isVisible("workflow-instances"), { timeout: 30_000 })
    .toBe(true);

  // Chart the map (the mock answers the naming and frontier sessions). Each
  // click auto-waits for its session's Done to be actionable — the old fixed
  // sleeps between the sessions (4s/2s) are replaced by waiting on the
  // observable DOM state (the next session's button appearing).
  await app.click("button", { hasText: "Done" });
  await app.click("button", { hasText: "Done" });

  // Two fog entries give the tray a pile to reorder.
  for (const brief of ["Choose the store", "Plot the reorder seam"]) {
    await app.click("button", { hasText: "Add fog entry", first: true });
    await app.waitForSelector("#cf-brief", { timeout: 10_000 });
    await app.fill("#cf-brief", brief);
    await submitFlowActionForm();
  }
  await app.waitForSelector(".fog-card", {
    hasText: "Choose the store",
    timeout: 30_000,
  });
  await app.waitForSelector(".fog-card", {
    hasText: "Plot the reorder seam",
    timeout: 30_000,
  });

  // The fog cards' data-ids are the hover/drag handles: the mini-map markers
  // carry the same id, so card↔marker pairing is one id.
  const firstId = await app.attr(".fog-card", "data-id", {
    hasText: "Choose the store",
  });
  const secondId = await app.attr(".fog-card", "data-id", {
    hasText: "Plot the reorder seam",
  });
  expect(firstId, "first fog card has an id").toBeTruthy();
  expect(secondId, "second fog card has an id").toBeTruthy();

  // Hover sync, dispatched on the real elements: hover card -> its marker
  // lights; hover marker -> its card lights. Lit applies the .hl class
  // asynchronously, so each light-up is polled instead of the old 60ms flush.
  await app.dispatch(
    ".fog-card",
    "mouseenter",
    { bubbles: true, composed: true },
    { hasText: "Choose the store" }
  );
  await expect
    .poll(() => app.count(`.fog-card[data-id="${firstId}"].hl`), {
      timeout: 5_000,
    })
    .toBe(1);
  await expect
    .poll(() => app.count(`circle[data-id="${firstId}"].hl`), {
      timeout: 5_000,
    })
    .toBe(1);
  await app.dispatch(
    ".fog-card",
    "mouseleave",
    { bubbles: true, composed: true },
    { hasText: "Choose the store" }
  );

  await app.dispatch(`circle[data-id="${secondId}"]`, "mouseenter", {
    bubbles: true,
    composed: true,
  });
  await expect
    .poll(() => app.count(`circle[data-id="${secondId}"].hl`), {
      timeout: 5_000,
    })
    .toBe(1);
  await expect
    .poll(() => app.count(`.fog-card[data-id="${secondId}"].hl`), {
      timeout: 5_000,
    })
    .toBe(1);
  await app.dispatch(`circle[data-id="${secondId}"]`, "mouseleave", {
    bubbles: true,
    composed: true,
  });

  // The fog drag-to-reorder — the ONE justified dispatched-event workaround
  // (real pointer drags of the HTML5 fog cards proved flaky), implemented in
  // the shared dragFogCardAbove helper (e2e/support/flows.mjs): synthetic
  // dragstart/dragover/drop/dragend on real geometry inside the app page. The
  // cards live in the served component's shadow root (workflow-instances →
  // dynamic-element-host → .mount → the served element), reached through that
  // direct path — the old recursive walker is gone; the events and the drop Y
  // are exactly what the tray's handlers see.
  const dragOrder = await dragFogCardAbove(firstId, secondId);
  expect(dragOrder, "the fog cards must be draggable").not.toBeNull();

  // The drop re-renders from the new clear order; poll until the pile flips
  // (the dragged card is first), then pin the full order.
  await expect
    .poll(() => app.attr(".fog-card", "data-id", { first: true }), {
      timeout: 10_000,
    })
    .toBe(secondId);
  const order = [
    await app.attr(".fog-card", "data-id", { first: true }),
    await app.attr(".fog-card", "data-id", { nth: 1 }),
  ].join(",");
  expect(order, "the dragged fog card reorders above the first").toBe(
    `${secondId},${firstId}`
  );
});
