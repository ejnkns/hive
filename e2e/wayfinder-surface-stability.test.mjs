// The stability contract end to end: while a running agent churns the flow
// snapshots (and across a WebSocket reconnect), the served wayfinder surface
// stays mounted — the same element instance — with the map view open, the
// cycled expedition theme, and the fog clear order intact, and the default
// per-workflow boards never flash. The highest seam of the
// flow-surface-stability effort: it proves stable surface identity
// (ticket 01), view-state persistence (ticket 02), and non-destructive
// reconnect (ticket 03) together.

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

// Runs `body` (page code) with one shared shadow-DOM walker: `hiveAll` holds
// every element under workflow-instances' shadow root, across nested shadow
// roots, in document order. The single walker keeps the deep queries in one
// place instead of duplicating the recursion per helper. The body is an
// expression — Playwright's string evaluate wraps it as `return (body);`, so
// the inner IIFE below needs its own explicit `return` for that to surface.
async function deepEval(body) {
  return page.evaluate(`(() => {
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
  await page.waitForFunction(
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
  return page.evaluate(() => {
    const host = document.querySelector("workflow-instances");
    const dyn = host?.shadowRoot?.querySelector("dynamic-element-host");
    window.__surface = dyn?.shadowRoot?.querySelector(".mount > *") ?? null;
    return window.__surface !== null;
  });
}

async function surfaceStillMounted() {
  return page.evaluate(() => {
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
  await page.evaluate(async () => {
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
  return page.evaluate((id) => window.__snapshotCounts?.[id] ?? 0, flowId);
}

test("wayfinder surface stays mounted with view state intact through churn and reconnect", async () => {
  await page.goto(`${baseUrl}/#/flows`);
  await page.waitForTimeout(800);

  const created = await page.evaluate(async () => {
    const res = await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        definitionId: "wayfinder",
        config: {
          name: "surface-stability-check",
          destination: "Keep the map open through the churn",
        },
      }),
    });
    return res.json();
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const flowId = "surface-stability-check";

  await page.goto(`${baseUrl}/#/flows/wayfinder/surface-stability-check`);
  await page.waitForSelector("workflow-instances", { timeout: 30_000 });
  // The custom surface mounts (its header lives in the served flow-component).
  await waitForDeep(".open-map", 30_000);
  await page.waitForTimeout(1_500);
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
    assert.ok(
      namingDone,
      `naming session done; buttons at failure: ${JSON.stringify(dump)}`
    );
  }
  assert.ok(await clickButton("Done"), "frontier session done");
  await page.waitForTimeout(1_500);

  // Seed the two fog entries the reorder will work on (via the action API —
  // each dispatch is itself a flow event that emits a snapshot frame).
  const addFogViaApi = (brief) =>
    page.evaluate(
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
  assert.equal(await addFogViaApi("First fog card"), true, "first fog entry");
  assert.equal(await addFogViaApi("Second fog card"), true, "second fog entry");
  await page.waitForTimeout(800);

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
  assert.notEqual(
    fogAfter,
    fogBefore,
    `the fog drag must reorder the pile (before=${fogBefore}, after=${fogAfter})`
  );

  // Cycle the expedition theme once (mountain → topo) and open the map view
  // BEFORE the churn window, so the churn exercises them. The theme button
  // lives in the header, which the map view replaces — click it first.
  assert.ok(await clickSelector(".theme-cycle"), "theme cycle clicked");
  assert.ok(await clickSelector(".open-map"), "map opened");
  await page.waitForTimeout(500);
  assert.ok(await captureSurface(), "the custom surface is mounted");

  const baseline = await surfaceState();
  assert.equal(baseline.mapOpen, true, "the map view is open");
  assert.equal(baseline.theme, "topo", "the cycled theme is active");
  assert.equal(
    baseline.defaultBoards,
    false,
    "the default boards are not showing"
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
      assert.equal(
        await addFogViaApi(`Churn fog entry ${churnEntries + 1}`),
        true,
        "churn fog entry"
      );
      churnEntries += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }
    assert.equal(
      await surfaceStillMounted(),
      true,
      "the surface element identity is stable through churn"
    );
    const mid = await surfaceState();
    assert.equal(mid.mapOpen, true, "the map view stays open through churn");
    assert.equal(mid.theme, "topo", "the theme stays cycled through churn");
    assert.equal(mid.defaultBoards, false, "no default-UI flash through churn");
    samples += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const churnEnd = await snapshotCount(flowId);
  assert.ok(
    churnEnd > churnStart,
    `snapshot churn must actually arrive during the window (before=${churnStart}, after=${churnEnd})`
  );
  assert.ok(
    samples >= 5,
    `sampled the surface across the churn window (${samples} samples)`
  );
  const storedFog = await page.evaluate(
    (id) => sessionStorage.getItem(`hive:view:${id}:fog-order`) ?? "",
    flowId
  );
  assert.equal(
    JSON.parse(storedFog).join(","),
    fogAfter,
    `the fog clear order persists through churn (stored=${storedFog}, reordered=${fogAfter})`
  );

  // Close the map (its back-link) so the header comes back: the fog tray must
  // render the reordered pile, and the cycled theme + map-open state must
  // restore when the map is reopened.
  assert.ok(await clickSelector(".back-link"), "map closed");
  await page.waitForTimeout(300);
  const closed = await surfaceState();
  assert.equal(closed.mapOpen, false, "the map view is closed");
  assert.equal(closed.theme, "topo", "the theme survives the close");
  assert.ok(
    closed.fogOrder === fogAfter || closed.fogOrder.startsWith(`${fogAfter},`),
    `the reordered fog pile renders after the churn (order=${closed.fogOrder})`
  );

  assert.ok(await clickSelector(".open-map"), "map reopened");
  await page.waitForTimeout(300);
  const reopened = await surfaceState();
  assert.equal(reopened.mapOpen, true, "the map view reopens");
  assert.equal(reopened.theme, "topo", "the theme survives the close/reopen");

  // Reconnect: dropping the network closes the app's WebSocket (the app
  // reconnects with backoff and the server re-sends init); the flow must
  // never drop out, so the surface element stays the same instance. Prove
  // the emulation actually took the network down first.
  await page.context().setOffline(true);
  const offlineProbe = await page.evaluate(async () => {
    try {
      await fetch("/api/flows", { cache: "no-store" });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(offlineProbe, true, "offline emulation is active");
  await page.waitForTimeout(4_000);
  await page.context().setOffline(false);
  await page.waitForTimeout(14_000);

  const afterReconnect = await surfaceState();
  assert.equal(
    await surfaceStillMounted(),
    true,
    "the surface element identity survives a WebSocket reconnect"
  );
  assert.equal(
    afterReconnect.mapOpen,
    true,
    "the map view stays open through reconnect"
  );
  assert.equal(
    afterReconnect.theme,
    "topo",
    "the theme stays cycled through reconnect"
  );
  assert.equal(
    afterReconnect.defaultBoards,
    false,
    "no default-UI flash through reconnect"
  );
});
