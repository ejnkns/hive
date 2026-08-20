// The stability contract end to end: while a running agent churns the flow
// snapshots (and across a WebSocket reconnect), the served wayfinder surface
// stays mounted — the same element instance — with the map view open, the
// cycled expedition theme, and the fog clear order intact, and the default
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

import { expect, inject, onTestFailed, test } from "vitest";
import { app } from "../support/browser-app.mjs";

const baseUrl = inject("baseUrl");

// Runs `body` (page code) with one shared shadow-DOM walker: `hiveAll` holds
// every element under workflow-instances' shadow root, across nested shadow
// roots, in document order. The single walker keeps the deep queries in one
// place instead of duplicating the recursion per helper. The body is an
// expression — the string evaluate wraps it as `return (body);`, so the inner
// IIFE below needs its own explicit `return` for that to surface.
async function deepEval(body) {
  return app.evaluate(`(() => {
    const hiveAll = [];
    const hiveWalk = (root) => {
      for (const el of root.querySelectorAll("*")) {
        hiveAll.push(el);
        if (el.shadowRoot) hiveWalk(el.shadowRoot);
      }
    };
    hiveWalk(document.querySelector("workflow-instances")?.shadowRoot ?? document);
    return (${body});
  })()`);
}

// Clicks the first button whose trimmed text equals `label`.
async function clickButton(label, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await deepEval(`(() => {
      const button = hiveAll.find(
        (el) => el.tagName === "BUTTON" && el.textContent?.trim() === ${JSON.stringify(label)}
      );
      if (!button) return false;
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true })
      );
      return true;
    })()`);
    if (clicked) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Clicks the first element matching `selector` (CSS, applied via the walker).
async function clickSelector(selector, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await deepEval(`(() => {
      const el = hiveAll.find((candidate) =>
        candidate.matches(${JSON.stringify(selector)})
      );
      if (!el) return false;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      return true;
    })()`);
    if (clicked) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Waits until at least one element matches `selector` in the shadow tree.
async function waitForDeep(selector, timeoutMs = 30_000) {
  await app.waitForFunction(
    (sel) => {
      const walk = (root) => {
        for (const el of root.querySelectorAll(sel)) return true;
        for (const el of root.querySelectorAll("*")) {
          if (el.shadowRoot && walk(el.shadowRoot)) return true;
        }
        return false;
      };
      return walk(document);
    },
    selector,
    { timeout: timeoutMs }
  );
}

// The mounted served surface: dynamic-element-host's .mount child inside
// workflow-instances — the element whose identity must stay stable. Stores it
// on window so identity can be compared across evaluate calls.
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

// A snapshot of the surface's observable state: map view open, active theme,
// rendered fog order, and whether the default per-workflow boards are showing.
async function surfaceState() {
  return deepEval(`({
    mapOpen: hiveAll.some((el) => el.classList?.contains("back-link")),
    theme:
      hiveAll.find((el) => el.classList?.contains("expedition"))?.dataset
        ?.theme ??
      hiveAll.find((el) => el.classList?.contains("theme-cycle"))?.textContent
        ?.trim() ??
      null,
    fogOrder: hiveAll
      .filter((el) => el.classList?.contains("fog-card"))
      .map((el) => el.dataset?.id ?? "")
      .join(","),
    defaultBoards:
      document.querySelector("workflow-instances")?.shadowRoot?.querySelector(
        ".flow"
      ) !== null,
  })`);
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
  // The flow name is unique per run so watch-mode re-runs never collide
  // (instance names are unique within a definition; the server 409s on dupes).
  const flowName = `surface-stability-check-${Date.now()}`;
  const flowId = flowName;
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
    { name: flowName, destination: "Keep the map open through the churn" }
  );
  expect(created.ok, JSON.stringify(created)).toBe(true);

  await app.open(`${baseUrl}/#/flows/wayfinder/${flowName}`);
  await app.waitForSelector("workflow-instances", { timeout: 30_000 });
  // The custom surface mounts (its header lives in the served flow-component).
  await waitForDeep(".open-map", 30_000);
  await app.waitForTimeout(1_500);
  await openSnapshotCounter();

  // Chart the map: the naming session runs the agent against the mock
  // provider; approve it, then approve the frontier session that auto-starts
  // (its file gate is what unlocks the add_fog_entry action).
  const namingDone = await clickButton("Done");
  if (!namingDone) {
    const dump = await deepEval(`hiveAll
      .filter((el) => el.tagName === "BUTTON")
      .map((el) => el.textContent?.trim())
      .join("|")`);
    expect(
      namingDone,
      `naming session done; buttons at failure: ${JSON.stringify(dump)}`
    ).toBe(true);
  }
  expect(await clickButton("Done"), "frontier session done").toBe(true);
  await app.waitForTimeout(1_500);

  // Seed the two fog entries the reorder will work on (via the action API —
  // each dispatch is itself a flow event that emits a snapshot frame).
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
  await app.waitForTimeout(800);

  // Drag the second fog card above the first into a session-local clear
  // order (dispatched events on real geometry, as in the interactions e2e).
  const fogIds = () =>
    deepEval(`hiveAll
      .filter((el) => el.classList?.contains("fog-card"))
      .map((el) => el.dataset?.id ?? "")
      .join(",")`);
  const fogBefore = await fogIds();
  await deepEval(`(() => {
    const cards = hiveAll.filter((el) => el.classList?.contains("fog-card"));
    const first = cards[0];
    const second = cards[1];
    const pile = second?.parentElement;
    const firstRect = first?.getBoundingClientRect();
    const dropY = (firstRect?.top ?? 0) + (firstRect?.height ?? 0) / 2 - 1;
    second?.dispatchEvent(
      new MouseEvent("dragstart", { bubbles: true, composed: true })
    );
    pile?.dispatchEvent(
      new MouseEvent("dragover", { bubbles: true, composed: true })
    );
    pile?.dispatchEvent(
      new MouseEvent("drop", { bubbles: true, composed: true, clientY: dropY })
    );
    pile?.dispatchEvent(
      new MouseEvent("dragend", { bubbles: true, composed: true })
    );
    return true;
  })()`);
  // The drop re-renders the pile from the new clear order; poll until it
  // flips (the interactions e2e does the same).
  const flipDeadline = Date.now() + 10_000;
  let fogAfter = fogBefore;
  while (Date.now() < flipDeadline) {
    fogAfter = await fogIds();
    if (fogAfter !== fogBefore) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  expect(
    fogAfter,
    `the fog drag must reorder the pile (before=${fogBefore}, after=${fogAfter})`
  ).not.toBe(fogBefore);

  // Cycle the expedition theme once (mountain → topo) and open the map view
  // BEFORE the churn window, so the churn exercises them. The theme button
  // lives in the header, which the map view replaces — click it first.
  expect(await clickSelector(".theme-cycle"), "theme cycle clicked").toBe(true);
  expect(await clickSelector(".open-map"), "map opened").toBe(true);
  await app.waitForTimeout(500);
  expect(await captureSurface(), "the custom surface is mounted").toBe(true);

  const baseline = await surfaceState();
  expect(baseline.mapOpen, "the map view is open").toBe(true);
  expect(baseline.theme, "the cycled theme is active").toBe("topo");
  expect(baseline.defaultBoards, "the default boards are not showing").toBe(
    false
  );

  // Churn with the map open: each add_fog_entry dispatch is a flow event
  // that coalesces into a flow_snapshot frame. Sample the surface identity
  // and view state across the window — the same element instance must stay
  // mounted the whole time, and the reordered fog order must survive.
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
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }
    expect(
      await surfaceStillMounted(),
      "the surface element identity is stable through churn"
    ).toBe(true);
    const mid = await surfaceState();
    expect(mid.mapOpen, "the map view stays open through churn").toBe(true);
    expect(mid.theme, "the theme stays cycled through churn").toBe("topo");
    expect(mid.defaultBoards, "no default-UI flash through churn").toBe(false);
    samples += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
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

  // Close the map (its back-link) so the header comes back: the fog tray must
  // render the reordered pile, and the cycled theme + map-open state must
  // restore when the map is reopened.
  expect(await clickSelector(".back-link"), "map closed").toBe(true);
  await app.waitForTimeout(300);
  const closed = await surfaceState();
  expect(closed.mapOpen, "the map view is closed").toBe(false);
  expect(closed.theme, "the theme survives the close").toBe("topo");
  expect(
    closed.fogOrder === fogAfter || closed.fogOrder.startsWith(`${fogAfter},`),
    `the reordered fog pile renders after the churn (order=${closed.fogOrder})`
  ).toBe(true);

  expect(await clickSelector(".open-map"), "map reopened").toBe(true);
  await app.waitForTimeout(300);
  const reopened = await surfaceState();
  expect(reopened.mapOpen, "the map view reopens").toBe(true);
  expect(reopened.theme, "the theme survives the close/reopen").toBe("topo");

  // Reconnect: dropping the network closes the app's WebSocket (the app
  // reconnects with backoff and the server re-sends init); the flow must
  // never drop out, so the surface element stays the same instance. Prove
  // the emulation actually took the network down first.
  await app.setOffline(true);
  const offlineProbe = await app.evaluate(async () => {
    try {
      await fetch("/api/flows", { cache: "no-store" });
      return false;
    } catch {
      return true;
    }
  });
  expect(offlineProbe, "offline emulation is active").toBe(true);
  await app.waitForTimeout(4_000);
  await app.setOffline(false);
  await app.waitForTimeout(14_000);

  const afterReconnect = await surfaceState();
  expect(
    await surfaceStillMounted(),
    "the surface element identity survives a WebSocket reconnect"
  ).toBe(true);
  expect(
    afterReconnect.mapOpen,
    "the map view stays open through reconnect"
  ).toBe(true);
  expect(
    afterReconnect.theme,
    "the theme stays cycled through reconnect"
  ).toBe("topo");
  expect(
    afterReconnect.defaultBoards,
    "no default-UI flash through reconnect"
  ).toBe(false);
});
