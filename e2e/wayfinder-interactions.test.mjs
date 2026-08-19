// Wayfinder interactions end-to-end: two-way hover sync between table cards
// and mini-map markers, click-to-focus, and drag-to-reorder in the fog tray.
// Drives the real browser + mock provider through the flow-component surface,
// using the same dispatched-event path the component tests use (a real
// pointer drag proved flaky for HTML5 drag-and-drop).

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

// Whether an element with the class AND text exists deep in the shadow tree.
async function deepHasText(className, text, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await page.evaluate(
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

// Submits the flow-action create form (the shared Svelte dialog).
async function submitFlowActionForm() {
  await page.waitForSelector(".dialog-actions button", { timeout: 10_000 });
  await page
    .locator(".dialog-actions button", { hasText: "Run" })
    .first()
    .click();
}

test("wayfinder interactions: hover sync card<->marker and fog drag reorder", async () => {
  await page.goto(`${baseUrl}/#/flows`);
  await page.waitForTimeout(800);

  const created = await page.evaluate(async () => {
    const res = await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        definitionId: "wayfinder",
        config: {
          name: "interaction-check",
          destination: "Pick the editor's storage layer",
        },
      }),
    });
    return res.json();
  });
  assert.equal(created.ok, true, JSON.stringify(created));

  await page.goto(`${baseUrl}/#/flows/wayfinder/interaction-check`);
  await page.waitForSelector("workflow-instances", { timeout: 30_000 });
  await page.waitForTimeout(2_000);

  // Chart the map (the mock answers the naming and frontier sessions).
  assert.ok(await waitAndClick("Done"), "naming session Done");
  await page.waitForTimeout(4_000);
  assert.ok(await waitAndClick("Done"), "frontier session Done");
  await page.waitForTimeout(2_000);

  // Two fog entries give the tray a pile to reorder.
  for (const brief of ["Choose the store", "Plot the reorder seam"]) {
    await page.locator("button", { hasText: "Add fog entry" }).first().click();
    await page.waitForSelector("#cf-brief", { timeout: 10_000 });
    await page.locator("#cf-brief").fill(brief);
    await submitFlowActionForm();
  }
  assert.ok(
    await deepHasText("fog-card", "Choose the store"),
    "the fog tray shows the first fog entry"
  );
  assert.ok(
    await deepHasText("fog-card", "Plot the reorder seam"),
    "the fog tray shows the second fog entry"
  );

  // Hover sync + fog reorder, driven with dispatched events on real geometry:
  // hover card -> its marker lights; hover marker -> its card lights; then
  // drag the second card above the first. Lit updates asynchronously, so each
  // dispatch awaits a frame before reading the classes.
  const scenario = await page.evaluate(async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 60));
    const walk = (root) => {
      const found = [];
      for (const el of root.querySelectorAll("*")) {
        found.push(el);
        if (el.shadowRoot) found.push(...walk(el.shadowRoot));
      }
      return found;
    };
    const all = walk(document);
    const fogCards = all.filter((el) => el.classList?.contains("fog-card"));
    const cardByTitle = (title) =>
      fogCards.find((el) => el.textContent?.includes(title));
    const markerById = (id) =>
      all.find((el) => el.tagName === "circle" && el.dataset?.id === id);
    const first = cardByTitle("Choose the store");
    const second = cardByTitle("Plot the reorder seam");
    const firstId = first?.dataset?.id ?? null;
    const secondId = second?.dataset?.id ?? null;
    const before = fogCards.map((el) => el.dataset?.id).join(",");

    const cardToMarker = [];
    first?.dispatchEvent(
      new MouseEvent("mouseenter", { bubbles: true, composed: true })
    );
    await flush();
    cardToMarker.push(first?.classList.contains("hl"));
    cardToMarker.push(markerById(firstId)?.classList.contains("hl"));
    first?.dispatchEvent(
      new MouseEvent("mouseleave", { bubbles: true, composed: true })
    );

    const markerToCard = [];
    markerById(secondId)?.dispatchEvent(
      new MouseEvent("mouseenter", { bubbles: true, composed: true })
    );
    await flush();
    markerToCard.push(markerById(secondId)?.classList.contains("hl"));
    markerToCard.push(second?.classList.contains("hl"));
    markerById(secondId)?.dispatchEvent(
      new MouseEvent("mouseleave", { bubbles: true, composed: true })
    );

    // Drag the second fog card so its drop lands just above the first card's
    // vertical middle (real geometry, deterministic insertion).
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

    return { firstId, secondId, before, cardToMarker, markerToCard };
  });

  assert.deepEqual(
    scenario.cardToMarker,
    [true, true],
    "hovering the card lights the card and its marker"
  );
  assert.deepEqual(
    scenario.markerToCard,
    [true, true],
    "hovering the marker lights the marker and its card"
  );

  // The drop re-renders from the new clear order; poll until the pile flips.
  const deadline = Date.now() + 10_000;
  let after = scenario.before;
  while (Date.now() < deadline && after === scenario.before) {
    after = await page.evaluate(() => {
      const walk = (root) => {
        const found = [];
        for (const el of root.querySelectorAll("*")) {
          if (el.classList?.contains("fog-card")) found.push(el.dataset?.id);
          if (el.shadowRoot) found.push(...walk(el.shadowRoot));
        }
        return found;
      };
      const host = document.querySelector("workflow-instances");
      return walk(host?.shadowRoot ?? document).join(",");
    });
    if (after !== scenario.before) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.equal(
    after,
    `${scenario.secondId},${scenario.firstId}`,
    "the dragged fog card reorders above the first"
  );
});
