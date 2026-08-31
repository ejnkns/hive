// The stability contract end to end: while a running agent churns the flow
// snapshots (and across a WebSocket reconnect), the served wayfinder surface
// stays mounted — the same element instance — with the map view open, the
// configured expedition theme, and the fog clear order intact, and the default
// per-workflow boards never flash. The highest seam of the
// flow-surface-stability effort: it proves stable surface identity
// (ticket 01), view-state persistence (ticket 02), and non-destructive
// reconnect (ticket 03) together.
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL via
// `inject`), and the app runs in a second page of the same browser, driven
// through the shared `app` wrapper (e2e/support/browser-app.mjs). The app
// page lives in its own browser context, so `app.setOffline` emulates the
// network down for the app only — the test iframe and its command channel stay
// online.
//
// Locator style (ticket 06): standard Playwright CSS selectors pierce the
// app's nested Lit shadow DOM, so every wait is an auto-retrying assertion on
// an observable (expect.poll over app.count / app.isVisible / app.textContent
// / app.waitForFunction-style evaluate) instead of a hand-rolled shadow-DOM
// walker or a waitForTimeout sleep. Two app.evaluate mechanisms are
// sanctioned and kept: the element-identity comparison (captureSurface /
// surfaceStillMounted — only page-side code can compare element references
// across time) and the fog drag-reorder dispatch (dispatched events on real
// geometry, the documented exception, as in the interactions e2e).
//
// First-render flake (ticket 06): the old node --test run passed in the
// parallel run but failed SOLO at first render — a 30s waitForSelector on
// `workflow-instances` — while under this runner it passes. Investigation of
// whether a real race exists: NO. createFlow registers the runtime
// synchronously BEFORE the POST returns (server/src/server/flow-registry/
// flow-lifecycle.ts: registerRuntime precedes the seed, so the flow is in
// getFlowRuntimes() the moment the test's create response resolves), and the
// page resolves the flow deterministically: FlowInstancePage.svelte checks
// the WS store first and falls back to a REST read when the init frame is
// late, so `workflow-instances` cannot fail to render because of store-vs-
// init ordering. The historical solo failure is therefore harness timing, not
// app timing: pre-Piece-0, a stale packaged UI served `{"error":"UI not
// found"}` on first render (the exact symptom: nothing ever mounts; the
// build-freshness guard in e2e/support/hive-test-app.mjs now fails fast
// instead), and the old runner had no retries for a slow cold start. The
// residual timing sensitivity in the ported file — sleeping before the
// create, waiting only on the SHELL element (workflow-instances) instead of
// the surface, and fixed waits around the Done clicks / churn / reconnect —
// is what this rewrite removes: every wait is now on an observable, with the
// first render gated on the served surface's own chrome wrapper
// (`.expedition`), which exists only once the flow's components are
// registered and rendered. The map-first shell (ticket 05) makes the map the
// primary surface for a populated expedition; the `.view-toggle` switches to
// the table and back.
//
// Offline emulation (ticket 06 probe): context.setOffline blocks NEW requests
// but does not terminate ESTABLISHED WebSocket connections in this
// environment — a probe watching a flow WS through 20s offline + 10s online
// saw the socket stay OPEN the whole time, and navigator.onLine flipping to
// false while a same-page fetch fails. So the app's flow socket never drops
// and the app's reconnect backoff never runs here; the old test's offline
// window + reconnect wait asserted a state that held trivially. This file
// keeps the emulation honest (the offline/online fetch probes and
// navigator.onLine ARE assertions), keeps the stability contract (the surface
// element identity and view state stay intact across the network-level
// interruption), and documents that the true WS-reconnect path is not
// triggerable from the test in this environment (it needs the server to close
// the socket, which nothing in the harness does).

import { expect, inject, test } from "vitest";
import { app } from "../support/browser-app.mjs";
import {
  captureFailureScreenshot,
  dragFogCardAbove,
} from "../support/flows.mjs";

const baseUrl = inject("baseUrl");

// The mounted served surface: dynamic-element-host's .mount child inside
// workflow-instances — the element whose identity must stay stable. Stores it
// on window so identity can be compared across evaluate calls (page-side code
// is the only way to compare element references across time).
async function captureSurface() {
  return app.evaluate(() => {
    const host = document.querySelector("workflow-instances");
    const dyn = host?.shadowRoot?.querySelector("dynamic-element-host");
    window.__surface = dyn?.shadowRoot?.querySelector(".mount > *") ?? null;
    return window.__surface !== null;
  });
}

async function surfaceStillMounted() {
  return app.evaluate(() => {
    const host = document.querySelector("workflow-instances");
    const dyn = host?.shadowRoot?.querySelector("dynamic-element-host");
    const current = dyn?.shadowRoot?.querySelector(".mount > *") ?? null;
    return (
      current !== null &&
      window.__surface !== null &&
      current === window.__surface
    );
  });
}

// Waits for `selector` to be present and then clicks it: the presence poll is
// the auto-retry, the click is Playwright auto-waiting on actionability. For
// buttons, `hasText` scopes the match to the labelled control. No walkers, no
// sleeps.
async function clickWhen(selector, { hasText, timeout = 20_000 } = {}) {
  const countSelector =
    hasText === undefined
      ? selector
      : `${selector}:has-text(${JSON.stringify(hasText)})`;
  await expect
    .poll(() => app.count(countSelector), { timeout })
    .toBeGreaterThan(0);
  await app.click(
    selector,
    hasText === undefined ? undefined : { hasText, first: true }
  );
}

// The expedition theme's --wf-* colors transition over --dur-slow (400ms,
// see ui/src/app.css) when the theme changes. Screenshots must be captured
// with the blend SETTLED — Playwright's animation disabling does not freeze
// CSS custom-property transitions, so a mid-blend capture would be
// run-timing-dependent. Observable-based wait: poll the computed --wf-accent
// until two consecutive reads agree (the value stops moving only once the
// transition completes).
async function settleThemeColors(timeout = 10_000) {
  let last = null;
  await expect
    .poll(
      async () => {
        const value = await app.evaluate(() => {
          const host = document.querySelector("workflow-instances");
          const dyn = host?.shadowRoot?.querySelector("dynamic-element-host");
          const el = dyn?.shadowRoot?.querySelector(".mount > *");
          const expedition = el?.shadowRoot?.querySelector(".expedition");
          return expedition
            ? getComputedStyle(expedition)
                .getPropertyValue("--wf-accent")
                .trim()
            : "";
        });
        const stable = last !== null && value === last;
        last = value;
        return stable;
      },
      { timeout, interval: 100 }
    )
    .toBe(true);
}

// Opens a second socket to the flow WS endpoint and counts flow_snapshot
// frames per flow on window.__snapshotCounts — churn is only "seen" once
// frames actually arrive, so the stability assertions always run against real
// snapshot pressure.
async function openSnapshotCounter() {
  await app.evaluate(async () => {
    const protocol = location.protocol === "http:" ? "ws:" : "wss:";
    window.__snapshotCounts = {};
    window.__snapshotSocket = new WebSocket(
      `${protocol}//${location.host}/api/flows/ws`
    );
    window.__snapshotSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "flow_snapshot") {
          window.__snapshotCounts[message.flow.id] =
            (window.__snapshotCounts[message.flow.id] ?? 0) + 1;
        }
      } catch {
        // ignore malformed frames
      }
    };
    await new Promise((resolve) => (window.__snapshotSocket.onopen = resolve));
  });
}

async function snapshotCount(flowId) {
  return app.evaluate((id) => window.__snapshotCounts?.[id] ?? 0, flowId);
}

test("wayfinder surface stays mounted with view state intact through churn and reconnect", async () => {
  const flowName = `surface-stability-check-${Date.now()}`;
  captureFailureScreenshot();

  // Boot the app page (its origin anchors the API + WS calls), create the
  // flow, then open the flow route. The creation POST does not depend on the
  // flows library settling — no sleep here.
  await app.open(`${baseUrl}/#/flows`);
  const created = await app.createFlow("wayfinder", {
    name: flowName,
    destination: "Keep the map open through the churn",
    expeditionTheme: "topo",
    basePath: inject("projectPath"),
  });
  expect(created.ok, JSON.stringify(created)).toBe(true);
  const flowId = created.flowId;

  await app.open(`${baseUrl}/#/flows/wayfinder/${flowName}`);
  // The shell host renders once the flow resolves (store or REST fallback);
  // the served surface mounts only after the flow's components load — wait on
  // the SURFACE (its chrome wrapper), the true first-render completion signal.
  await expect
    .poll(() => app.isVisible("workflow-instances"), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(() => app.isVisible(".expedition"), { timeout: 30_000 })
    .toBe(true);
  await openSnapshotCounter();

  // Chart the map: the naming session runs the agent against the mock
  // provider; approve it, then approve the frontier session that auto-starts
  // (its file gate is what unlocks the add_fog_entry action). Each "Done" is
  // waited on as an observable (the session's action appears only when the
  // session lands interactive) — no fixed sleeps between them.
  await clickWhen("button", { hasText: "Done", timeout: 40_000 });
  await clickWhen("button", { hasText: "Done", timeout: 40_000 });

  // Seed the two fog entries the reorder will work on (via the action API —
  // each dispatch is itself a flow event that emits a snapshot frame). The
  // observable: both cards render in the tray.
  const addFogViaApi = (brief) =>
    app.evaluate(
      async ({ flowId, brief }) => {
        const res = await fetch(`/api/flows/${flowId}/actions/add_fog_entry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief }),
        });
        return res.ok;
      },
      { flowId, brief }
    );
  expect(await addFogViaApi("First fog card"), "first fog entry").toBe(true);
  expect(await addFogViaApi("Second fog card"), "second fog entry").toBe(true);
  // The first fog entry makes the expedition populated, so the map-first
  // shell takes over. Switch to the table, where the fog tray lives.
  await app.waitForSelector(".view-toggle", { timeout: 30_000 });
  await app.click(".view-toggle button", { hasText: "Table", first: true });
  await expect.poll(() => app.count(".fog-card"), { timeout: 10_000 }).toBe(2);

  // Drag the second fog card above the first into a session-local clear
  // order. Dispatched events on real geometry — the documented exception, as
  // in the interactions e2e — implemented once in the shared dragFogCardAbove
  // helper (flows.mjs): only page-side code can hold the element refs and read
  // the geometry the drop handler keys on. The helper returns the resulting
  // pile order, which the persistence assertion below reads back.
  const firstFogId = await app.attr(".fog-card", "data-id", { first: true });
  const secondFogId = await app.attr(".fog-card", "data-id", { nth: 1 });
  expect(firstFogId, "first fog card has an id").toBeTruthy();
  expect(secondFogId, "second fog card has an id").toBeTruthy();
  const fogAfter = await dragFogCardAbove(firstFogId, secondFogId);
  expect(
    fogAfter,
    "the fog tray must render two draggable cards"
  ).not.toBeNull();
  // The drop re-renders the pile from the new clear order; the first card's
  // title flips to the dragged entry (a pure CSS observable — no walker).
  await expect
    .poll(() => app.textContent(".fog-card"), { timeout: 10_000 })
    .toContain("Second fog card");

  // The expedition theme comes from the flow config (created with "topo");
  // switch back to the map-first view BEFORE the churn window so the churn
  // exercises the surface with the map primary.
  await expect
    .poll(() => app.count('.expedition[data-theme="topo"]'), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  await app.click(".view-toggle button", { hasText: "Map", first: true });
  await expect
    .poll(() => app.count(".map-layout"), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect.poll(() => captureSurface(), { timeout: 10_000 }).toBe(true);

  // The baseline: the map-first surface, configured topo theme, and the
  // default per-workflow boards are not showing (the served flow-component
  // owns the page).
  expect(
    await app.count(".map-layout"),
    "the map-first surface is showing"
  ).toBeGreaterThan(0);
  expect(
    await app.count('.expedition[data-theme="topo"]'),
    "the configured theme is active"
  ).toBeGreaterThan(0);
  expect(await app.count(".flow"), "the default boards are not showing").toBe(
    0
  );

  // Visual contract (ticket 10): the map view open with the configured
  // expedition theme, captured now that the surface is settled (the baseline asserts
  // above all passed on observables, so the render is stable). The theme's
  // color blend must finish before the shot (see settleThemeColors), and the
  // capture targets the surface element itself (workflow-instances) so the app
  // shell's top bar — whose breadcrumb shows the RUN-UNIQUE flow name — is
  // excluded: that text changes every run and would make the baseline
  // inherently unstable.
  await settleThemeColors();
  await app.assertScreenshot("surface-map-topo", {
    element: "workflow-instances",
  });

  // Churn with the map open: each add_fog_entry dispatch is a flow event that
  // coalesces into a flow_snapshot frame. After each dispatch, WAIT on the
  // observable (a new frame on the counting socket), then sample the surface
  // identity and view state — the same element instance must stay mounted the
  // whole time, and the reordered fog order must survive. The loop keeps a
  // bounded sampling cadence between the observable-based asserts.
  const churnStart = await snapshotCount(flowId);
  const deadline = Date.now() + 12_000;
  let samples = 0;
  let churnEntries = 0;
  while (Date.now() < deadline) {
    if (churnEntries < 4) {
      expect(
        await addFogViaApi(`Churn fog entry ${churnEntries + 1}`),
        "churn fog entry"
      ).toBe(true);
      churnEntries += 1;
      await expect
        .poll(() => snapshotCount(flowId), { timeout: 5_000 })
        .toBeGreaterThan(churnStart + churnEntries - 1);
    }
    expect(
      await surfaceStillMounted(),
      "the surface element identity is stable through churn"
    ).toBe(true);
    expect(
      await app.count(".map-layout"),
      "the map-first surface stays through churn"
    ).toBeGreaterThan(0);
    expect(
      await app.count('.expedition[data-theme="topo"]'),
      "the theme stays topo through churn"
    ).toBeGreaterThan(0);
    expect(await app.count(".flow"), "no default-UI flash through churn").toBe(
      0
    );
    samples += 1;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  const churnEnd = await snapshotCount(flowId);
  expect(
    churnEnd > churnStart,
    `snapshot churn must actually arrive during the window (before=${churnStart}, after=${churnEnd})`
  ).toBe(true);
  expect(
    samples >= 5,
    `sampled the surface across the churn window (${samples} samples)`
  ).toBe(true);
  const storedFog = await app.evaluate(
    (id) => sessionStorage.getItem(`hive:view:${id}:fog-order`) ?? "",
    flowId
  );
  expect(
    JSON.parse(storedFog).join(","),
    `the fog clear order persists through churn (stored=${storedFog}, reordered=${fogAfter})`
  ).toBe(fogAfter);

  // Switch to the table: the fog tray must render the reordered pile (head =
  // the dragged card) plus the four churn entries, and the topo theme must
  // survive the switch.
  await clickWhen(".view-toggle button", { hasText: "Table" });
  await expect
    .poll(() => app.count(".map-layout"), { timeout: 10_000 })
    .toBe(0);
  await expect.poll(() => app.count(".fog-card"), { timeout: 10_000 }).toBe(6);
  await expect
    .poll(() => app.textContent(".fog-card"), { timeout: 10_000 })
    .toContain("Second fog card");
  expect(
    await app.count('.expedition[data-theme="topo"]'),
    "the theme survives the close"
  ).toBeGreaterThan(0);

  // Visual contract (ticket 10): the fog tray renders the reordered pile — the
  // dragged card on top. Capture the tray's own box (the pile with its fanned
  // fog cards) so the assertion is about the pile, not the rest of the page.
  // The theme's colors are long settled here (the churn window elapsed
  // since the theme mounted), but the settle wait keeps every capture under
  // the same contract.
  await settleThemeColors();
  await app.assertScreenshot("surface-fog-reordered", {
    element: ".station:has(.fog-card)",
  });

  // Switch back to the map: the map-first state and the topo theme restore.
  await clickWhen(".view-toggle button", { hasText: "Map" });
  await expect
    .poll(() => app.count(".map-layout"), { timeout: 10_000 })
    .toBeGreaterThan(0);
  expect(
    await app.count('.expedition[data-theme="topo"]'),
    "the theme survives the close/reopen"
  ).toBeGreaterThan(0);

  // Network-level interruption: drop the network for the app context only
  // (the test iframe and command channel stay online), prove the emulation is
  // real (the fetch probe fails offline, navigator.onLine flips, and the fetch
  // recovers after setOffline(false)), and assert the stability contract
  // across the interruption: the same surface element instance stays mounted
  // with the map open, the topo theme, and no default-UI flash. (Probe
  // finding, see the header: context.setOffline blocks new requests but does
  // not terminate established WebSockets in this environment, so the app's
  // flow socket never drops and its reconnect backoff never runs here — the
  // contract asserted below is the surface's behavior across the real
  // network-level interruption the emulation DOES produce.)
  await app.setOffline(true);
  expect(
    await app.evaluate(async () => {
      try {
        await fetch("/api/flows", { cache: "no-store" });
        return false;
      } catch {
        return true;
      }
    }),
    "offline emulation is active"
  ).toBe(true);
  expect(
    await app.evaluate(() => navigator.onLine),
    "the browser reports the network down"
  ).toBe(false);
  await expect
    .poll(() => surfaceStillMounted(), { timeout: 10_000 })
    .toBe(true);
  expect(
    await app.count(".map-layout"),
    "the map-first surface stays while offline"
  ).toBeGreaterThan(0);
  expect(
    await app.count('.expedition[data-theme="topo"]'),
    "the theme stays topo while offline"
  ).toBeGreaterThan(0);
  expect(await app.count(".flow"), "no default-UI flash while offline").toBe(0);

  await app.setOffline(false);
  await expect
    .poll(
      async () =>
        app.evaluate(async () => {
          try {
            await fetch("/api/flows", { cache: "no-store" });
            return true;
          } catch {
            return false;
          }
        }),
      { timeout: 10_000 }
    )
    .toBe(true);

  // The interruption is over: the surface element identity must still be the
  // same instance, and the view state (map open, topo theme, no default-UI
  // flash) must be intact.
  await expect
    .poll(() => surfaceStillMounted(), { timeout: 10_000 })
    .toBe(true);
  expect(
    await app.count(".map-layout"),
    "the map-first surface stays through the interruption"
  ).toBeGreaterThan(0);
  expect(
    await app.count('.expedition[data-theme="topo"]'),
    "the theme stays topo through the interruption"
  ).toBeGreaterThan(0);
  expect(
    await app.count(".flow"),
    "no default-UI flash through the interruption"
  ).toBe(0);

  // Visual contract (ticket 10): the view state (map open, topo theme, and
  // the churned fog on the map) persisted through the network-level
  // interruption. (The true page-reload path is the wayfinder-reload e2e's
  // seam; a reload here would break the element-identity contract asserted
  // above, so the persistence proof across the interruption is captured
  // visually instead.) Same surface-element capture as the first shot, for the
  // same reasons (shell breadcrumb carries the run-unique flow name; theme
  // colors must be settled).
  await settleThemeColors();
  await app.assertScreenshot("surface-view-persisted", {
    element: "workflow-instances",
  });
});
