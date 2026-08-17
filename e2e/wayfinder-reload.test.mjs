// Regression: the served wayfinder components must survive a page reload. The
// reload race (LitFlowHost disposes an in-flight load whose stale cleanup used
// to clobber the newer load's registration) lost the custom views on reload.
// Start the charting session, reload, and verify the expedition map's custom
// chat still renders.

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

async function chatDump() {
  return page.evaluate(() => {
    const inputs = [];
    const sessionLabels = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll("input, textarea")) {
        inputs.push(el.placeholder ?? "");
      }
      for (const el of root.querySelectorAll(".session-label")) {
        sessionLabels.push(el.textContent?.trim() ?? "");
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    const mapPresent = (() => {
      const found = [];
      const deep = (root) => {
        // The flow-level custom view's root — the expedition dashboard the
        // served flow-component renders (it replaced the per-workflow
        // expedition-map view when the flow component shipped).
        for (const el of root.querySelectorAll(".expedition")) {
          found.push(el.className);
        }
        for (const el of root.querySelectorAll("*")) {
          if (el.shadowRoot) deep(el.shadowRoot);
        }
      };
      deep(document);
      return found.length > 0;
    })();
    return { inputs, sessionLabels, mapPresent };
  });
}

test("charting session and expedition map survive reload", async () => {
  await page.goto(`${baseUrl}/#/flows`);
  await page.waitForTimeout(800);
  const created = await page.evaluate(async () => {
    const res = await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        definitionId: "wayfinder",
        config: { name: "session-check", destination: "A spec to hand off" },
      }),
    });
    return res.json();
  });
  assert.equal(created.ok, true, JSON.stringify(created));

  await page.goto(`${baseUrl}/#/flows/wayfinder/session-check`);
  await page.waitForSelector("workflow-instances", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const walk = (root) => {
      const buttons = [];
      for (const el of root.querySelectorAll("button")) buttons.push(el);
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) buttons.push(...walk(el.shadowRoot));
      }
      return buttons;
    };
    walk(document)
      .find((b) => b.textContent?.includes("Start charting"))
      ?.click();
  });
  await page.waitForTimeout(3000);
  const before = await chatDump();
  console.log("BEFORE", JSON.stringify(before));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("workflow-instances", { timeout: 30000 });
  await page.waitForTimeout(4000);
  const after = await chatDump();
  console.log("AFTER", JSON.stringify(after));

  assert.equal(
    after.mapPresent,
    true,
    "the expedition map must survive reload"
  );
  assert.ok(
    after.sessionLabels.length > 0,
    `the session chat must survive reload (got ${JSON.stringify(after.sessionLabels)})`
  );
  assert.ok(
    after.inputs.some((p) => p.includes("Type a message")),
    `the session input must survive reload (got ${JSON.stringify(after.inputs)})`
  );
});
