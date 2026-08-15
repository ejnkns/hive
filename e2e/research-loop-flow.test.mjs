// Ticket 4 — the generated research-loop flow, end to end: an authoring
// session converges on a research-loop definition module with a custom gate reference
// and a custom websearch tool reference, the agent writes the referenced files
// in-conversation, and the module set passes the gate and saves. The e2e then
// instantiates the saved definition and runs it for real: the custom websearch
// tool executes (its transport is stubbed — the executor returns the shaped
// result directly) and the custom gate decides the transition to done. The
// mock provider drives both the authoring conversation and the runtime
// research agent.
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

async function waitFor(predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the research-loop e2e");
}

// The authoring session's live instance state (the flow is hidden; fetch by
// the stored flow id). The session's storage key is re-keyed from "new" to the
// saved definition id once save_definition lands, so look up any live key.
async function sessionState() {
  return page.evaluate(async () => {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith("hive:author:")
    );
    for (const key of keys) {
      const stored = localStorage.getItem(key);
      if (!stored) continue;
      const res = await fetch(`/api/flows/${encodeURIComponent(stored)}`);
      if (!res.ok) continue;
      const flow = await res.json();
      return flow.instances?.[0]?.state ?? null;
    }
    return null;
  });
}

async function fetchJson(url, options) {
  return page.evaluate(
    async ({ url, options }) => {
      const res = await fetch(url, options);
      if (!res.ok) return null;
      return res.json();
    },
    { url, options: options ?? {} }
  );
}

test("a generated research-loop flow runs with its custom gate and websearch tool", async () => {
  // Start a lucky authoring session asking for a research loop.
  await page.goto(`${baseUrl}/#/flows/new`);
  await page.waitForSelector("textarea", { timeout: 15_000 });
  await page
    .locator("textarea")
    .first()
    .fill("Build a research loop flow with a custom gate and a websearch tool");
  await page.locator("button", { hasText: "I'm feeling lucky" }).click();

  // The agent sets the definition module, validates, writes the referenced
  // files, and saves the registered definition — all in-conversation.
  const state = await waitFor(async () => {
    const s = await sessionState();
    return s?.workflowInstanceState?.savedDefinitionId === "research-loop"
      ? s
      : null;
  }, 90_000);
  assert.equal(state.workflowInstanceState.savedDefinitionId, "research-loop");
  assert.equal(state.workflowInstanceState.report?.passed, true);
  const gateFile =
    state.workflowInstanceState.files?.["./gates/approved.ts"] ?? "";
  assert.ok(
    gateFile.includes('verdict === "approved"'),
    "the session's file set carries the implemented gate"
  );

  // The definition registers and is servable: the source is the pure-data
  // definition module (references by ref path — the entry imports nothing),
  // and the registered record carries the parsed data form.
  const definition = await fetchJson("/api/flows/definitions/research-loop");
  assert.ok(definition, "the definition must register");
  assert.match(definition.source, /export const flow: FlowDefinition = \{/);
  assert.match(definition.source, /ref: "\.\/gates\/approved\.ts"/);
  assert.ok(
    definition.definition?.id === "researchLoop",
    "the registered record carries the pure-data definition"
  );

  // Instantiate the saved definition and run it: the custom tool executes and
  // the custom gate decides the transition.
  const created = await fetchJson("/api/flows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      definitionId: "research-loop",
      config: { name: "Research One" },
    }),
  });
  assert.ok(created, "the definition must instantiate");

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
  assert.ok(dispatched, "the add_research action must dispatch");

  const flow = await fetchJson(
    `/api/flows/${encodeURIComponent(created.flowId)}`
  );
  const instance = flow?.instances?.find(
    (entry) => entry.state.currentState === "searching"
  );
  const instanceId = instance?.id;
  assert.ok(instanceId, "the research instance must exist");

  // Release the interactive search task with the query.
  const sent = await fetchJson(
    `/api/flows/${encodeURIComponent(created.flowId)}/instances/${encodeURIComponent(instanceId)}/task/input`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "find hive" }),
    }
  );
  assert.ok(sent, "task input must be accepted");

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
  assert.equal(done.state.workflowInstanceState.verdict, "approved");
  const transcript = JSON.stringify(
    done.state.taskOutputs?.search?.output ?? {}
  );
  assert.ok(
    transcript.includes("Hive docs"),
    "the custom websearch tool returned its shaped result"
  );
  assert.ok(
    transcript.includes("good result"),
    "the completion summary fed the extractor and the gate"
  );
});
