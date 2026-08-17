// The wayfinder creation → charting journey, end to end:
// 1. Creating with a destination seeds it into the charting instance.
// 2. The charting session STARTS on submission (no "Start charting" click) —
//    the expedition map shows the naming chat with the destination as the
//    opening user message.
// 3. Reloading preserves it all.

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

async function pageState() {
  return page.evaluate(() => {
    const walk = (root) => {
      const out = [];
      for (const el of root.querySelectorAll("*")) out.push(el);
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) out.push(...walk(el.shadowRoot));
      }
      return out;
    };
    const all = walk(document);
    const mapTitles = all
      .filter((el) => el.classList?.contains("destination-title"))
      .map((el) => el.textContent?.trim());
    const chatInputs = all
      .filter(
        (el) => el.tagName === "INPUT" && (el.placeholder ?? "").length > 0
      )
      .map((el) => el.placeholder);
    const overviewPresent =
      document
        .querySelector("workflow-instances")
        ?.shadowRoot?.querySelector(".overview") !== null;
    return { mapTitles, chatInputs, overviewPresent };
  });
}

test("creating a wayfinder instance starts the charting session with the destination", async () => {
  await page.goto(`${baseUrl}/#/flows`);
  await page.waitForTimeout(800);
  const created = await page.evaluate(async () => {
    const res = await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        definitionId: "wayfinder",
        config: {
          name: "expedition-check",
          destination: "A spec for the routing layer",
        },
      }),
    });
    return res.json();
  });
  assert.equal(created.ok, true, JSON.stringify(created));

  await page.goto(`${baseUrl}/#/flows/wayfinder/expedition-check`);
  await page.waitForSelector("workflow-instances", { timeout: 30000 });
  await page.waitForTimeout(2500);

  const state = await pageState();
  console.log("STATE", JSON.stringify(state));

  // The creation destination lands on the map.
  assert.ok(
    state.mapTitles.some((t) => t.includes("routing layer")),
    `the map must show the creation destination (got ${JSON.stringify(state.mapTitles)})`
  );
  // The charting session started on submission — the naming chat is live
  // (no "Start charting" click needed).
  assert.ok(
    state.chatInputs.some((p) => p.includes("session")),
    `the naming session chat must be open (got ${JSON.stringify(state.chatInputs)})`
  );
  // A single active workflow: no overview bar (it would be redundant).
  assert.equal(
    state.overviewPresent,
    false,
    "no overview for a single workflow"
  );

  // Reload preserves it all.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("workflow-instances", { timeout: 30000 });
  await page.waitForTimeout(2500);
  const after = await pageState();
  console.log("AFTER-RELOAD", JSON.stringify(after));
  assert.deepEqual(after, state, "reload must not change the state");
});
