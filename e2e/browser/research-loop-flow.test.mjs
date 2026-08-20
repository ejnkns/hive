// Ticket 4 — the generated research-loop flow, end to end: an authoring
// session converges on a research-loop definition module with a custom gate reference
// and a custom websearch tool reference, the agent writes the referenced files
// in-conversation, and the module set passes the gate and saves. The e2e then
// instantiates the saved definition and runs it for real: the custom websearch
// tool executes (its transport is stubbed — the executor returns the shaped
// result directly) and the custom gate decides the transition to done. The
// mock provider drives both the authoring conversation and the runtime
// research agent.
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL via
// `inject`), and the app runs in a second page of the same browser, driven
// through the shared `app` wrapper (e2e/support/browser-app.mjs). The harness
// helpers (session-state snapshot, fetchJson, waitFor, delete-first
// definition registration) live in the shared support module
// (e2e/support/flows.mjs) — this file's copies were deleted by ticket 07.

import { expect, inject, onTestFailed, test } from "vitest";
import { app } from "../support/browser-app.mjs";
import {
  deleteDefinition,
  fetchJson,
  findSessionState,
  waitFor,
} from "../support/flows.mjs";

const baseUrl = inject("baseUrl");

test("a generated research-loop flow runs with its custom gate and websearch tool", async () => {
  // The flow name is unique per run so watch-mode re-runs never collide
  // (instance names are unique within a definition; the server 409s on dupes).
  const flowName = `Research One ${Date.now()}`;
  onTestFailed(async () => {
    const shot = await app.screenshot("failure");
    if (shot) console.log(`[app screenshot] ${shot}`);
  });

  // Start a lucky authoring session asking for a research loop.
  await app.open(`${baseUrl}/#/flows/new`);
  // The authoring session registers the "research-loop" definition via its
  // save_definition call; on a watch re-run (shared server + data dir) that
  // save would 409 against the leftover, so drop any previous run's record
  // first (a fresh run just 404s — ignored).
  await deleteDefinition("research-loop");
  await app.waitForSelector("textarea", { timeout: 15_000 });
  await app
    .fill("textarea", "Build a research loop flow with a custom gate and a websearch tool", {
      first: true,
    });
  await app.click("button", { hasText: "I'm feeling lucky" });

  // The agent sets the definition module, validates, writes the referenced
  // files, and saves the registered definition — all in-conversation.
  const state = await waitFor(async () => {
    const s = await findSessionState();
    return s?.workflowInstanceState?.savedDefinitionId === "research-loop"
      ? s
      : null;
  }, 90_000);
  expect(state.workflowInstanceState.savedDefinitionId).toBe("research-loop");
  expect(state.workflowInstanceState.report?.passed).toBe(true);
  const gateFile =
    state.workflowInstanceState.files?.["./gates/approved.ts"] ?? "";
  expect(
    gateFile.includes('verdict === "approved"'),
    "the session's file set carries the implemented gate"
  ).toBe(true);

  // The definition registers and is servable: the source is the pure-data
  // definition module (references by ref path — the entry imports nothing),
  // and the registered record carries the parsed data form.
  const definition = await fetchJson("/api/flows/definitions/research-loop");
  expect(definition, "the definition must register").toBeTruthy();
  expect(definition.source).toMatch(/export const flow: FlowDefinition = \{/);
  expect(definition.source).toMatch(/ref: "\.\/gates\/approved\.ts"/);
  expect(
    definition.definition?.id === "researchLoop",
    "the registered record carries the pure-data definition"
  ).toBe(true);

  // Instantiate the saved definition and run it: the custom tool executes and
  // the custom gate decides the transition.
  const created = await fetchJson("/api/flows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      definitionId: "research-loop",
      config: { name: flowName },
    }),
  });
  expect(created, "the definition must instantiate").toBeTruthy();

  // The flow's initial state auto-runs an input-seeded AI task, so the
  // engine does not seed an empty instance (a phantom run with nothing to
  // work on) — the research instance comes from the flow-level add_research
  // action, carrying the query.
  const dispatched = await fetchJson(
    `/api/flows/${encodeURIComponent(created.flowId)}/actions/add_research`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hive" }),
    }
  );
  expect(dispatched, "the add_research action must dispatch").toBeTruthy();

  const flow = await fetchJson(
    `/api/flows/${encodeURIComponent(created.flowId)}`
  );
  const instance = flow?.instances?.find(
    (entry) => entry.state.currentState === "searching"
  );
  const instanceId = instance?.id;
  expect(instanceId, "the research instance must exist").toBeTruthy();

  // Release the interactive search task with the query.
  const sent = await fetchJson(
    `/api/flows/${encodeURIComponent(created.flowId)}/instances/${encodeURIComponent(instanceId)}/task/input`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "find hive" }),
    }
  );
  // KNOWN FAILURE (ticket 08/09, see docs/known-issues.md): the interactive
  // task input POST is rejected, so `sent` is null and this assertion fails.
  expect(sent, "task input must be accepted").toBeTruthy();

  // The custom gate decides the transition: the instance reaches done with an
  // approved verdict, and the websearch tool's shaped result is in the
  // transcript (the mock provider stubs the transport, not the tool).
  const done = await waitFor(async () => {
    const f = await fetchJson(
      `/api/flows/${encodeURIComponent(created.flowId)}`
    );
    const instance = f?.instances?.find((i) => i.id === instanceId);
    return instance?.state?.currentState === "done" ? instance : null;
  }, 30_000);
  expect(done.state.workflowInstanceState.verdict).toBe("approved");
  const transcript = JSON.stringify(
    done.state.taskOutputs?.search?.output ?? {}
  );
  expect(
    transcript.includes("Hive docs"),
    "the custom websearch tool returned its shaped result"
  ).toBe(true);
  expect(
    transcript.includes("good result"),
    "the completion summary fed the extractor and the gate"
  ).toBe(true);
});
