// Wayfinder ticket phase end-to-end: chart → add ticket → graduate → claim
// (research) → resolve to closed → start build. Drives the real browser + mock
// provider through the flow-component surface (the flow-level custom view) and
// the served ticket card, beyond the creation/charting e2e.

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

test("wayfinder ticket phase: chart → add research ticket → graduate → claim → closed → start build", async () => {
  await page.goto(`${baseUrl}/#/flows`);
  await page.waitForTimeout(800);

  const created = await page.evaluate(async () => {
    const res = await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        definitionId: "wayfinder",
        config: {
          name: "ticket-check",
          destination: "Pick the editor's storage layer",
        },
      }),
    });
    return res.json();
  });
  assert.equal(created.ok, true, JSON.stringify(created));

  await page.goto(`${baseUrl}/#/flows/wayfinder/ticket-check`);
  await page.waitForSelector("workflow-instances", { timeout: 30_000 });
  await page.waitForTimeout(2_000);

  // Chart: the naming session is agent-initiating (the mock answers it), so
  // Done → frontier, then Done → charted.
  assert.ok(await waitAndClick("Done"), "naming session Done");
  await page.waitForTimeout(4_000);
  assert.ok(await waitAndClick("Done"), "frontier session Done");
  await page.waitForTimeout(2_000);

  // Add a research ticket through the flow-action create form.
  await page.locator("button", { hasText: "Add ticket" }).first().click();
  await page.waitForSelector("#cf-title", { timeout: 10_000 });
  await page.locator("#cf-title").fill("Choose the store");
  await page.locator("#cf-question").fill("localStorage or IndexedDB?");
  await page.locator("#cf-type").selectOption("research");
  await submitFlowActionForm();

  // The ticket lands in fog (normalize runs), then the graduate action opens.
  assert.ok(
    await deepHasText("type-badge", "research"),
    "the served ticket card renders the research type badge"
  );
  assert.ok(await waitAndClick("Graduate to ready"), "graduate the fog ticket");

  // Claim the ready research ticket; the one-shot research agent resolves it
  // (the mock completes it), then assemble closes the ticket.
  assert.ok(await waitAndClick("Claim for research"), "claim the ticket");

  // Once the ticket closes the map is clear, so Start build becomes available.
  assert.ok(
    await waitAndClick("Start build", 30_000),
    "start build after the frontier cleared"
  );
  await submitFlowActionForm();

  // The build workflow starts in its specing state.
  assert.ok(
    await deepHasText("build-state", "Specing"),
    "the build section shows the specing state"
  );
});
