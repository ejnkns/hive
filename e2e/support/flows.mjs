// Shared harness helpers for the migrated e2e files (e2e/browser/*.test.mjs).
// The app runs in a second page of the same browser (see e2e/app-commands.ts);
// everything here drives it through the shared `app` wrapper, so one support
// module owns flow/definition registration, session-state snapshots, and the
// chat reply — the per-file copies these helpers replace were deleted from the
// test files as part of the ticket-07 consolidation.
//
// Style note: files migrated to locator style (editor-flow, wayfinder-*,
// research-loop, queen-bee) write their own auto-retrying assertions
// (expect.poll / app.waitForSelector / app.waitForFunction) instead of these
// helpers; the poll-loop helpers this module used to carry were deleted once
// the last consumer (queen-bee, ticket 09) migrated.
import { onTestFailed } from "vitest";
import { app } from "./browser-app.mjs";

// ── flow / definition registration via the built server's API ──────────────

// The slug mirrors the server's slugify (shared/src/slugify.ts).
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

// Registers a definition by name (+ optional referenced files), dropping any
// previous run's record first — watch re-runs share the server + data dir and
// the server 409s on a duplicate name. A fresh run's delete 404s (ignored).
export async function registerDefinition(name, source, files) {
  const slug = slugify(name);
  return app.evaluate(
    async ({ slug, name, source, files }) => {
      await fetch(`/api/flows/definitions/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      const res = await fetch("/api/flows/definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, source, files }),
      });
      return res.ok ? await res.json() : null;
    },
    { slug, name, source, files }
  );
}

// Drops a definition's record (best-effort) so a UI save in a test can
// re-register it on a watch re-run without a 409.
export async function deleteDefinition(slug) {
  await app.evaluate(async (slug) => {
    await fetch(`/api/flows/definitions/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    });
  }, slug);
}

// GET/POST JSON to the built server from the app page's origin. A non-2xx
// response THROWS with the HTTP status, URL, and body — the spec's
// failure-diagnostics decision: an API handshake failure must surface its
// actual cause in the test output, not a silent null. Call sites inside
// `expect.poll` that should keep polling on a transient error wrap the call
// with `.catch(() => null)`.
export async function fetchJson(url, options) {
  return app.evaluate(
    async ({ url, options }) => {
      const res = await fetch(url, options);
      if (!res.ok) {
        const body = await res.text();
        const error = new Error(
          `HTTP ${res.status} ${url}: ${body.slice(0, 300)}`
        );
        error.status = res.status;
        error.body = body;
        throw error;
      }
      return res.json();
    },
    { url, options: options ?? {} }
  );
}

// ── session / state snapshots ───────────────────────────────────────────────

// The session's live instance state, read via REST (the flow is hidden, so
// the library list does not include it — fetch by the stored id). The storage
// key is per definition ("new" for a new definition, the id otherwise).
export async function sessionState(definitionKey = "new") {
  return app.evaluate(async (definitionKey) => {
    const stored = localStorage.getItem(`hive:author:${definitionKey}`);
    if (!stored) return null;
    const res = await fetch(`/api/flows/${encodeURIComponent(stored)}`);
    if (!res.ok) return null;
    const flow = await res.json();
    return flow.instances?.[0]?.state ?? null;
  }, definitionKey);
}

// The session's live instance state under ANY live storage key (the key is
// re-keyed from "new" to the saved definition id once save_definition lands).
export async function findSessionState() {
  return app.evaluate(async () => {
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

// ── chat reply ──────────────────────────────────────────────────────────────

// Sends a chat message to the first interactive chat-session: the input only
// renders once a startOnUserInput session turns interactive, so the wait IS
// the auto-retry; the message is typed into the real input and the send
// button clicked (Enter dispatched when a session has no button). Returns
// false when no interactive chat appears within the timeout — the queen-bee
// requirements-session reply pattern keeps its poll-bounded boolean result.
export async function sendChatMessage(text, timeoutMs = 15_000) {
  try {
    await app.waitForSelector("chat-session input", { timeout: timeoutMs });
  } catch {
    return false;
  }
  await app.fill("chat-session input", text, { first: true });
  try {
    await app.click("chat-session button", { first: true });
  } catch {
    await app.dispatch("chat-session input", "keydown", {
      key: "Enter",
      bubbles: true,
      composed: true,
    });
  }
  return true;
}

// ── failure artifacts ────────────────────────────────────────────────────────

// Registers the app-page failure artifacts for the current test: the app-page
// screenshot (vitest's own screenshotFailures only captures the runner page,
// which never shows the app) plus a truncated body-text snapshot. The flow
// name is unique per run so the artifacts never collide across watch re-runs.
export function captureFailureScreenshot(label = "failure") {
  onTestFailed(async () => {
    const shot = await app.screenshot(label);
    if (shot) console.log(`[app screenshot] ${shot}`);
    try {
      const text = await app.textContent("body");
      if (text) console.log(`[app page snapshot] ${text.slice(0, 2_000)}`);
    } catch {
      // The app page may never have been opened; the screenshot above already
      // handled that case.
    }
  });
}

// ── flow-editor surface ──────────────────────────────────────────────────────

// The editable source of the no-session files editor (the code-editor element
// carries the real draft in its textarea's value — textContent is not
// authoritative after programmatic fills). Only page-side code can read it.
export function editorValue() {
  return app.evaluate(
    () =>
      document
        .querySelector("code-editor")
        ?.shadowRoot?.querySelector("textarea")?.value ?? ""
  );
}

// Waits until the no-session files editor has bound its source and, when
// `text` is given, that source contains it. The editor binds asynchronously
// (fresh page, fetch, render), so this is the auto-retry for the "editor is
// ready" state the old files polled with the same deep path.
export async function waitForEditorValue(text, timeout = 15_000) {
  await app.waitForFunction(
    (text) => {
      const value =
        document
          .querySelector("code-editor")
          ?.shadowRoot?.querySelector("textarea")?.value ?? "";
      return text === undefined ? value !== "" : value.includes(text);
    },
    text,
    { timeout }
  );
}

// ── flow-action create form (the shared Svelte dialog) ──────────────────────

// Submits the flow-action create form: waits for the dialog's action buttons,
// then clicks Run.
export async function submitFlowActionForm() {
  await app.waitForSelector(".dialog-actions button", { timeout: 10_000 });
  await app.click(".dialog-actions button", { hasText: "Run", first: true });
}

// ── fog drag-reorder (the ONE justified dispatched-event workaround) ─────────

// Page-side drag of the fog card `secondId` above `firstId`: synthetic
// dragstart/dragover/drop/dragend on real geometry, exactly what the tray's
// handlers see (a real pointer drag of the HTML5 fog cards proved flaky; only
// page-side code can hold the element refs and read the geometry the drop
// handler keys on). Returns the resulting pile order ("id,id") or null when
// either card is not found.
export async function dragFogCardAbove(firstId, secondId) {
  return app.evaluate(
    ({ firstId, secondId }) => {
      const host = document.querySelector("workflow-instances");
      const root = host?.shadowRoot
        ?.querySelector("dynamic-element-host")
        ?.shadowRoot?.querySelector(".mount > *")?.shadowRoot;
      if (!root) return null;
      // The spatial shell nests the table workbench, and served elements get
      // generated hive-served-* tags, so selectors cannot name the layers —
      // pierce every shadow root under the served element for the fog cards.
      const fogCards = [];
      const walk = (shadow) => {
        for (const el of shadow.querySelectorAll(".fog-card")) {
          fogCards.push(el);
        }
        for (const el of shadow.querySelectorAll("*")) {
          if (el.shadowRoot !== null) walk(el.shadowRoot);
        }
      };
      walk(root);
      const first = fogCards.find(
        (card) => card.getAttribute("data-id") === firstId
      );
      const second = fogCards.find(
        (card) => card.getAttribute("data-id") === secondId
      );
      if (!first || !second) return null;
      const pile = second.parentElement;
      const firstRect = first.getBoundingClientRect();
      const dropY = (firstRect.top ?? 0) + (firstRect.height ?? 0) / 2 - 1;
      second.dispatchEvent(
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
      return `${second.dataset?.id ?? ""},${first.dataset?.id ?? ""}`;
    },
    { firstId, secondId }
  );
}
