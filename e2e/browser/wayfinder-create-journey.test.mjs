// The wayfinder creation → charting journey, end to end:
// 1. Creating with a destination seeds it into the charting instance.
// 2. The charting session STARTS on submission (no "Start charting" click) —
//    the expedition map shows the naming chat with the destination as the
//    opening user message.
// 3. Reloading preserves it all.
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL via
// `inject`), and the app runs in a second page of the same browser, driven
// through the shared `app` wrapper (e2e/support/browser-app.mjs).

import { expect, inject, onTestFailed, test } from "vitest";
import { app } from "../support/browser-app.mjs";

const baseUrl = inject("baseUrl");

async function pageState() {
  return app.evaluate(() => {
    const walk = (root) => {
      const out = [];
      for (const el of root.querySelectorAll("*")) out.push(el);
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) out.push(...walk(el.shadowRoot));
      }
      return out;
    };
    const all = walk(document);
    // The map card's destination note shows the seeded destination.
    const mapTitles = all
      .filter((el) => el.classList?.contains("dest-note"))
      .map((el) => el.textContent?.trim());
    const chatInputs = all
      .filter(
        (el) => el.tagName === "INPUT" && (el.placeholder ?? "").length > 0
      )
      .map((el) => el.placeholder);
    // The shared chat-session renders a session header naming the running
    // phase (e.g. the Naming step) above the transcript.
    const sessionLabels = all
      .filter((el) => el.classList?.contains("session-label"))
      .map((el) => el.textContent?.trim());
    const overviewPresent =
      document
        .querySelector("workflow-instances")
        ?.shadowRoot?.querySelector(".overview") !== null;
    return { mapTitles, chatInputs, sessionLabels, overviewPresent };
  });
}

test("creating a wayfinder instance starts the charting session with the destination", async () => {
  // The flow name is unique per run so watch-mode re-runs never collide
  // (instance names are unique within a definition; the server 409s on dupes).
  const flowName = `expedition-check-${Date.now()}`;
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
    { name: flowName, destination: "A spec for the routing layer" }
  );
  expect(created.ok, JSON.stringify(created)).toBe(true);

  await app.open(`${baseUrl}/#/flows/wayfinder/${flowName}`);
  await app.waitForSelector("workflow-instances", { timeout: 30000 });
  await app.waitForTimeout(2500);

  const state = await pageState();
  console.log("STATE", JSON.stringify(state));

  // The creation destination lands on the map.
  expect(
    state.mapTitles.some((t) => t.includes("routing layer")),
    `the map must show the creation destination (got ${JSON.stringify(state.mapTitles)})`
  ).toBe(true);
  // The charting session started on submission — the naming chat is live
  // (no "Start charting" click needed), with the phase named in its header.
  expect(
    state.sessionLabels.some((label) =>
      label?.toLowerCase().includes("naming")
    ),
    `the naming session chat must be open (got ${JSON.stringify(state.sessionLabels)})`
  ).toBe(true);
  // A single active workflow: no overview bar (it would be redundant).
  expect(state.overviewPresent, "no overview for a single workflow").toBe(
    false
  );

  // Reload preserves it all.
  await app.reload();
  await app.waitForSelector("workflow-instances", { timeout: 30000 });
  await app.waitForTimeout(2500);
  const after = await pageState();
  console.log("AFTER-RELOAD", JSON.stringify(after));
  expect(after, "reload must not change the state").toEqual(state);
});
