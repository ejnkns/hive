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

// Clicks a button whose text equals `label`, across nested shadow roots.
async function waitAndClick(buttonLabel, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate((buttonLabel) => {
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

// Clicks the first element matching `selector` anywhere in the shadow tree.
async function clickDeep(selector, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate((selector) => {
      const walk = (root) => {
        for (const el of root.querySelectorAll(selector)) return el;
        for (const el of root.querySelectorAll("*")) {
          if (el.shadowRoot) {
            const found = walk(el.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      };
      const host = document.querySelector("workflow-instances");
      const el = walk(host?.shadowRoot ?? document);
      if (!el) return false;
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true })
      );
      return true;
    }, selector);
    if (clicked) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Waits until an element matching `selector` exists deep in the shadow tree.
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

// Submits the flow-action create form (the shared Svelte dialog).
async function submitFlowActionForm() {
  await page.waitForSelector(".dialog-actions button", { timeout: 10_000 });
  await page
    .locator(".dialog-actions button", { hasText: "Run" })
    .first()
    .click();
}

// Adds a fog entry through the flow action form.
async function addFogEntry(brief) {
  await page.locator("button", { hasText: "Add fog entry" }).first().click();
  await page.waitForSelector("#cf-brief", { timeout: 10_000 });
  await page.locator("#cf-brief").fill(brief);
  await submitFlowActionForm();
  await page.waitForTimeout(400);
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
  return page.evaluate(() => {
    const walk = (root, out) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.classList?.contains("expedition")) {
          out.push({ kind: "expedition", theme: el.dataset?.theme ?? null });
        }
        if (el.classList?.contains("theme-cycle")) {
          out.push({
            kind: "theme-cycle",
            text: el.textContent?.trim() ?? null,
          });
        }
        if (el.classList?.contains("fog-card")) {
          out.push({ kind: "fog-card", id: el.dataset?.id ?? null });
        }
        if (el.shadowRoot) walk(el.shadowRoot, out);
      }
      return out;
    };
    const out = [];
    walk(document, out);
    const expedition = out.find((e) => e.kind === "expedition");
    const themeCycle = out.find((e) => e.kind === "theme-cycle");
    const host = document.querySelector("workflow-instances");
    return {
      mapOpen: expedition !== undefined,
      theme: expedition?.theme ?? themeCycle?.text ?? null,
      fogOrder: out
        .filter((e) => e.kind === "fog-card")
        .map((e) => e.id)
        .join(","),
      defaultBoards: host?.shadowRoot?.querySelector(".flow") !== null,
    };
  });
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

  // Chart the map first: the naming and frontier sessions run the agent
  // against the mock provider (real snapshot churn) and unlock the
  // add_fog_entry action (gated on the frontier being charted).
  assert.ok(await waitAndClick("Done"), "naming session done");
  await page.waitForTimeout(4_000);
  assert.ok(await waitAndClick("Done"), "frontier session done");
  await page.waitForTimeout(2_000);

  // The churn window: each fog-entry creation is a flow event that emits a
  // coalesced flow_snapshot frame, so the stability assertions below run
  // against real snapshot pressure.
  const churnStart = await snapshotCount(flowId);
  await addFogEntry("First fog card");
  await addFogEntry("Second fog card");

  // Drag the second fog card above the first into a session-local clear
  // order (dispatched events on real geometry, as in the interactions e2e).
  const fogIds = () =>
    page.evaluate(() => {
      const walk = (root, out) => {
        for (const el of root.querySelectorAll("*")) {
          if (el.classList?.contains("fog-card")) {
            out.push(el.dataset?.id ?? "");
          }
          if (el.shadowRoot) walk(el.shadowRoot, out);
        }
        return out;
      };
      return walk(document, []).join(",");
    });
  const fogBefore = await fogIds();
  await page.evaluate(async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 60));
    const walk = (root) => {
      const found = [];
      for (const el of root.querySelectorAll("*")) {
        if (el.classList?.contains("fog-card")) found.push(el);
        if (el.shadowRoot) found.push(...walk(el.shadowRoot));
      }
      return found;
    };
    const cards = walk(document).filter((el) =>
      el.classList?.contains("fog-card")
    );
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
      new MouseEvent("drop", {
        bubbles: true,
        composed: true,
        clientY: dropY,
      })
    );
    pile?.dispatchEvent(
      new MouseEvent("dragend", { bubbles: true, composed: true })
    );
    await flush();
  });
  // The drop re-renders the pile from the new clear order; poll until it
  // flips (the interactions e2e does the same).
  const deadline = Date.now() + 10_000;
  let fogAfter = fogBefore;
  while (Date.now() < deadline) {
    fogAfter = await fogIds();
    if (fogAfter !== fogBefore) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.notEqual(
    fogAfter,
    fogBefore,
    `the fog drag must reorder the pile (before=${fogBefore}, after=${fogAfter})`
  );
  const churnEnd = await snapshotCount(flowId);
  assert.ok(
    churnEnd > churnStart,
    `snapshot churn must actually arrive during the window (before=${churnStart}, after=${churnEnd})`
  );

  // Cycle the expedition theme once (mountain → topo), then open the map
  // view — the theme button lives in the header, which the map view replaces.
  assert.ok(await clickDeep(".theme-cycle"), "theme cycle clicked");
  assert.ok(await clickDeep(".open-map"), "map opened");
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
  const storedFog = await page.evaluate(
    (id) => sessionStorage.getItem(`hive:view:${id}:fog-order`) ?? "",
    flowId
  );
  assert.equal(
    JSON.parse(storedFog).join(","),
    fogAfter,
    `the fog clear order persists through churn (stored=${storedFog}, reordered=${fogAfter})`
  );

  // Reconnect: dropping the network closes the app's WebSocket (the app
  // reconnects with backoff and the server re-sends init); the flow must
  // never drop out, so the surface element stays the same instance.
  await page.context().setOffline(true);
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
