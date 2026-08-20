// Shared harness helpers for the migrated e2e files (e2e/browser/*.test.mjs).
// The app runs in a second page of the same browser (see e2e/app-commands.ts);
// everything here drives it through the shared `app` wrapper, so one support
// module owns flow/definition registration, session-state snapshots, and the
// chat reply — the per-file copies these helpers replace were deleted from the
// test files as part of the ticket-07 consolidation.
//
// Style note: files migrated to locator style (editor-flow, wayfinder-*) write
// their own auto-retrying assertions (expect.poll / app.waitForSelector /
// app.waitForFunction) instead of these helpers; the poll-loop helpers below
// are kept for the files tickets 08/09 own (queen-bee, research-loop), whose
// behavioral assertions and known failures must not change.
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

// GET/POST JSON to the built server from the app page's origin; null on
// non-2xx so `expect(...).toBeTruthy()` surfaces the handshake failure.
export async function fetchJson(url, options) {
  return app.evaluate(
    async ({ url, options }) => {
      const res = await fetch(url, options);
      if (!res.ok) return null;
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

// ── poll loops (kept for the files tickets 08/09 own; migrated files use
//    expect.poll / app.waitForSelector / app.waitForFunction instead) ────────

// Polls until a predicate returns a truthy value.
export async function waitFor(predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out");
}

// ── queen-bee section surface (moved verbatim — the file's known failure
//    (ticket 08) must still fail identically, so behavior is unchanged) ─────

// The live DOM state of one workflow section: card titles + every visible
// button text, across nested shadow roots.
export async function sectionState(label) {
  return app.evaluate((label) => {
    const walkButtons = (root) => {
      const buttons = [];
      for (const el of root.querySelectorAll("button")) {
        const t = el.textContent?.trim();
        if (t && !buttons.includes(t)) buttons.push(t);
      }
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) buttons.push(...walkButtons(el.shadowRoot));
      }
      return buttons;
    };
    const host = document.querySelector("workflow-instances");
    const shadow = host?.shadowRoot;
    const flow = Array.from(shadow?.querySelectorAll(".flow") ?? []).find(
      (f) => f.querySelector(".flow-label")?.textContent === label
    );
    if (!flow) return null;
    const titleOf = (el) => {
      const itemHeader = el?.shadowRoot?.querySelector("item-header");
      return (
        itemHeader?.shadowRoot?.querySelector(".title")?.textContent ?? null
      );
    };
    const cards = Array.from(flow.querySelectorAll("dynamic-element-host")).map(
      (hostEl) =>
        titleOf(hostEl.shadowRoot?.querySelector(".mount > *")) ?? null
    );
    return { cards, buttons: walkButtons(shadow ?? document) };
  }, label);
}

export async function waitForSection(label, predicate, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await sectionState(label);
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// Waits until a button with the exact label is visible (across nested shadow
// roots), then clicks it. Returns false if it never appears.
export async function waitAndClick(buttonLabel, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await app.evaluate((buttonLabel) => {
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
