// Queen-bee card lifecycle end-to-end in a real browser against the real
// server (mock model provider). This is the "all layers meet" test the manual
// pass was required for: real persistence, real git worktrees, the real Lit
// rendering surface, and the real browser's custom-element constraints. It
// guards the browser/WS/schema seams that unit and component tests cannot.
//
// Runs under Vitest browser mode (e2e/vitest.config.ts): the built server and
// mock provider boot on the Node side in e2e/global-setup.ts (base URL and the
// fixture project path via `inject`), and the app runs in a second page of the
// same browser, driven through the shared `app` wrapper
// (e2e/support/browser-app.mjs).
//
// Locator style (ticket 09): every wait is an auto-retrying assertion
// (app.waitForSelector / expect.poll on the live REST flow snapshot) — no
// hand-rolled shadow-DOM walkers, no waitForTimeout sleeps. The flow state is
// read back through the same /api/flows/<flowId> snapshot the UI renders, so
// the poll assertions check the authoritative contract (instance state, task
// outputs, the review verdict) while the DOM assertions check what the user
// sees (buttons, chat input, the done card's title).

import { expect, inject, test } from "vitest";
import { app } from "../support/browser-app.mjs";
import {
  captureFailureScreenshot,
  sendChatMessage,
} from "../support/flows.mjs";

const baseUrl = inject("baseUrl");
const projectPath = inject("projectPath");

test("queen-bee card lifecycle: onboarding → requirements → plan → card → done", async () => {
  const flowName = `e2e-project-${Date.now()}`;
  captureFailureScreenshot();

  // The live flow snapshot the polls read (the same /api/flows/<flowId> the
  // UI renders): instance states, task outputs, the running task context.
  const flowDetail = () =>
    app.evaluate(async (flowName) => {
      const res = await fetch("/api/flows");
      const body = await res.json();
      const flow = (body.flows ?? []).find((f) => f.config?.name === flowName);
      if (!flow) return null;
      return (await fetch(`/api/flows/${flow.id}`)).json();
    }, flowName);

  // Flows library lists the built-ins.
  await app.open(`${baseUrl}/#/flows`);
  await app.waitForSelector("text=Queen Bee", { timeout: 15_000 });
  expect(await app.count("text=Wayfinder")).toBe(1);

  // Create a flow bound to the fixture project.
  await app.open(`${baseUrl}/#/flows/queen-bee/new`);
  await app.waitForSelector("input", { timeout: 15_000 });
  await app.fill("input", flowName, { first: true });
  await app.fill("input", projectPath, { nth: 1 });
  await app.click("button", { hasText: "Create instance", first: true });
  await app.waitForSelector(".flow-header", { timeout: 20_000 });

  // Onboarding completes on its own (operations only); the edge then fans the
  // requirements instance in — the section renders exactly one card.
  await expect
    .poll(
      () =>
        app.count(
          'workflow-instances .flow[data-workflow-id="requirements"] item-header'
        ),
      { timeout: 40_000 }
    )
    .toBe(1);

  // Requirements session: start, answer the agent's clarifying question
  // (startOnUserInput — the first reply starts the agent, which explores and
  // asks; the second reply answers, the draft lands, REQUIREMENTS_COMPLETE).
  await app.click("button", { hasText: "Start requirements session" });
  expect(await sendChatMessage("yes, the greeting is deterministic")).toBe(
    true
  );
  // The agent explores (tool calls) and then asks — wait for the question in
  // the live transcript before answering, so the second reply is the answer
  // (the mock's conversation is keyed on the last message).
  await expect
    .poll(
      async () => {
        const detail = await flowDetail();
        const requirements = detail?.instances?.find(
          (instance) => instance.workflowId === "requirements"
        );
        const messages =
          requirements?.state?.runningTaskContext?.messages ??
          requirements?.state?.taskOutputs?.draft?.output?.messages ??
          [];
        return messages.some(
          (message) =>
            message.role === "assistant" &&
            typeof message.content === "string" &&
            message.content.includes("deterministic greeting?")
        );
      },
      { timeout: 40_000 }
    )
    .toBe(true);
  expect(await sendChatMessage("yes, exactly one deterministic greeting")).toBe(
    true
  );

  // Requirements → complete → planning (planner proposes) → planned → accept.
  // Each button only renders once its gate passes, so the click's auto-wait
  // covers the planner run between submit and accept.
  for (const step of [
    "Submit for planning",
    "Accept proposal",
    "Accept all and create cards",
  ]) {
    await app.click("button", { hasText: step });
  }

  // The edge fans the plan out into a cards instance (ready, runnable).
  await expect
    .poll(
      () =>
        app.count(
          'workflow-instances .flow[data-workflow-id="cards"] item-header'
        ),
      { timeout: 40_000 }
    )
    .toBe(1);
  await app.waitForSelector("button", {
    hasText: "Run Worker Agent",
    timeout: 20_000,
  });

  // Run the worker (mock writes + commits + submits) → validation → review →
  // the reviewer approves → accept merges to done. The worker is a one-shot
  // ai-chat session: its running task context is non-interactive, and the
  // chat renders without an input row (the requirements chat had one).
  await app.click("button", { hasText: "Run Worker Agent" });
  await expect
    .poll(
      async () => {
        const detail = await flowDetail();
        const cards = detail?.instances?.find(
          (instance) => instance.workflowId === "cards"
        );
        return cards?.state?.runningTaskContext?.role === "ai-chat";
      },
      { timeout: 30_000, interval: 25 }
    )
    .toBe(true);
  expect(
    await app.count("chat-session input"),
    "the one-shot worker chat is read-only (no input) — the requirements chat had one"
  ).toBe(0);

  // The reviewer approves: the review task's verdict is "approved", the
  // freshness check reports the review fresh, and the accept action appears.
  await expect
    .poll(
      async () => {
        const detail = await flowDetail();
        const cards = detail?.instances?.find(
          (instance) => instance.workflowId === "cards"
        );
        const review = cards?.state?.taskOutputs?.review?.output;
        return (
          review?.verdict === "approved" &&
          cards?.state?.workflowInstanceState?.reviewIsStale === false
        );
      },
      { timeout: 30_000 }
    )
    .toBe(true);
  await app.click("button", { hasText: "Accept work" });

  // The merge completes: the card lands in the done state.
  await expect
    .poll(
      async () => {
        const detail = await flowDetail();
        const cards = detail?.instances?.find(
          (instance) => instance.workflowId === "cards"
        );
        return cards?.state?.currentState === "done";
      },
      { timeout: 30_000 }
    )
    .toBe(true);

  // Add an idea: the served idea-card (a served-at-runtime custom component)
  // must load, register, and render live — the end-to-end guard for the
  // browser custom-element + re-render bugs that component tests could not
  // catch (the demo card vanished until the loader registered classes and the
  // host re-rendered after the async load).
  await app.click("button", { hasText: "Add idea", first: true });
  await app.waitForSelector(".action-form input", { timeout: 10_000 });
  await app.fill(".action-form input", "A great idea", { first: true });
  await app.click(".dialog-actions button", { hasText: "Run", first: true });
  await app.waitForSelector(".idea-title", { timeout: 15_000 });
  const ideaTitle = await app.textContent(".idea-title");
  expect(ideaTitle?.trim(), "the served idea card renders the idea title").toBe(
    "A great idea"
  );

  // The done card carries the plan's title.
  const done = await app.textContent(
    'workflow-instances .flow[data-workflow-id="cards"] .title'
  );
  expect(
    (done ?? "").includes("deterministic greeting"),
    `done card title present (${JSON.stringify(done)})`
  ).toBe(true);
});
