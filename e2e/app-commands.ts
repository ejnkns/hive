import type { BrowserContext, Page } from "playwright";
import type { BrowserCommand } from "vitest/node";
import "@vitest/browser-playwright";
import { join } from "node:path";

// The app under test cannot live in the vitest test iframe: browser-mode tests
// execute inside an iframe on the runner's page, and navigating that page to
// the external app would destroy the iframe (and the running test with it).
// So each test session gets a SECOND page in the same browser, created here on
// the Node side, and the tests drive it through these custom commands
// (`vitest/browser` `commands`).
//
// The app page lives in its OWN browser context — a sibling of the runner's
// session context, not a page inside it — so the app's network emulation
// (appSetOffline), websockets, and storage are isolated from the test iframe
// and its command channel. (The old node --test harness's `browser.newPage()`
// also gave the app page a private context, so this preserves that seam.)
//
// Commands that take page code (appEvaluate, appWaitForFunction) receive the
// code as a STRING: the test files serialize their functions with
// `fn.toString()` (functions do not cross the command channel), and the string
// is evaluated inside the app page — a function source is called with the arg,
// any other expression is evaluated. Playwright locators/auto-wait apply to
// every command; tests add auto-retry on top with `expect.poll`.

// Navigate the session's app page to the given URL, creating the app context
// + page on first use.
export const openApp: BrowserCommand<[url: string]> = async (
  { context, sessionId },
  url
) => {
  let session = appSessions.get(sessionId);
  if (!session || session.page.isClosed()) {
    if (session) {
      // A stale app context (e.g. the page died mid-run): drop it and start
      // over with a fresh context.
      await session.context.close().catch(() => {});
      appSessions.delete(sessionId);
    }
    const browser = context.browser();
    if (!browser) {
      throw new Error("no browser available to host the app page");
    }
    const appContext = await browser.newContext();
    const page = await appContext.newPage();
    // The old harness's page carried a 120s default timeout; keep it so
    // long-settling flows (agent turns, reloads) never trip locator waits.
    page.setDefaultTimeout(120_000);
    session = { page, context: appContext };
    appSessions.set(sessionId, session);
    page.on("close", () => {
      appContext.close().catch(() => {});
    });
  }
  await session.page.goto(url, { waitUntil: "domcontentloaded" });
};

// Create a flow instance through the built server's API, from the app page's
// origin. Mirrors the old harness's in-page `fetch("/api/flows")`.
export const createFlow: BrowserCommand<
  [definitionId: string, config: Record<string, unknown>]
> = async ({ sessionId }, definitionId, config) => {
  const appPage = requireAppSession(sessionId).page;
  const origin = new URL(appPage.url()).origin;
  const response = await fetch(`${origin}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definitionId, config }),
  });
  return response.json();
};

// Evaluate code in the app page. `fn` is a function SOURCE string (defined and
// called with `arg`, mirroring the old `page.evaluate(fn, arg)`) or an
// expression string (evaluated — the old `page.evaluate("(() => {...})()")`
// deep-walker style). Both run inside the app page, never on the Node side.
export const appEvaluate: BrowserCommand<[fn: string, arg?: unknown]> = async (
  { sessionId },
  fn,
  arg
) => {
  const appPage = requireAppSession(sessionId).page;
  return appPage.evaluate(
    ({ fn, arg }) => {
      // Constructing the function has no side effects; calling it with the
      // arg reproduces page.evaluate(fn, arg). An expression string (e.g. an
      // IIFE) evaluates in place. Playwright does not call string-evaluated
      // functions with the arg, hence the explicit definition + call.
      const value = new Function(`return (${fn});`)();
      return typeof value === "function" ? value(arg) : value;
    },
    { fn, arg }
  );
};

export const appClick: BrowserCommand<
  [selector: string, options?: { hasText?: string; first?: boolean }]
> = async ({ sessionId }, selector, options = {}) => {
  let locator = locatorFor(requireAppSession(sessionId), selector, options);
  if (options.first) locator = locator.first();
  await locator.click();
};

export const appFill: BrowserCommand<
  [selector: string, text: string, options?: { first?: boolean; nth?: number }]
> = async ({ sessionId }, selector, text, options = {}) => {
  let locator = requireAppSession(sessionId).page.locator(selector);
  if (options.first) locator = locator.first();
  else if (options.nth !== undefined) locator = locator.nth(options.nth);
  await locator.fill(text);
};

export const appSelectOption: BrowserCommand<
  [selector: string, value: string]
> = async ({ sessionId }, selector, value) => {
  await requireAppSession(sessionId).page.locator(selector).selectOption(value);
};

export const appTextContent: BrowserCommand<[selector: string]> = async (
  { sessionId },
  selector
) => {
  const element = requireAppSession(sessionId).page.locator(selector).first();
  return element.textContent();
};

// Read an attribute off the first (or nth) element the piercing selector
// matches, e.g. the fog cards' data-id used as the hover/drag handles. Returns
// null when nothing matches so `expect.poll` can retry on a not-yet-rendered
// element (unlike textContent/getAttribute on a missing element, which throw).
export const appAttr: BrowserCommand<
  [
    selector: string,
    name: string,
    options?: { hasText?: string; first?: boolean; nth?: number },
  ]
> = async ({ sessionId }, selector, name, options = {}) => {
  const base = locatorFor(requireAppSession(sessionId), selector, options);
  if ((await base.count()) === 0) return null;
  const target = options.first
    ? base.first()
    : options.nth !== undefined
      ? base.nth(options.nth)
      : base.first();
  return target.getAttribute(name);
};

// Dispatch a synthetic event (mouseenter/mouseleave/…) on the element the
// piercing selector matches. This is the locator-side equivalent of the old
// files' `dispatchEvent(new MouseEvent(...))` deep-walkers: the selector finds
// the element across the nested shadow roots, and the event fires on the real
// element — no walker, no hit-testing (a real pointer hover is layout-fragile
// on the piled fog cards). Playwright auto-waits for the element to be
// attached before dispatching.
export const appDispatch: BrowserCommand<
  [
    selector: string,
    eventType: string,
    eventInit?: Record<string, unknown>,
    options?: { hasText?: string; first?: boolean },
  ]
> = async (
  { sessionId },
  selector,
  eventType,
  eventInit = {},
  options = {}
) => {
  let locator = locatorFor(requireAppSession(sessionId), selector, options);
  if (options.first) locator = locator.first();
  await locator.dispatchEvent(eventType, eventInit);
};

export const appIsVisible: BrowserCommand<[selector: string]> = async (
  { sessionId },
  selector
) => {
  const session = appSessions.get(sessionId);
  if (!session || session.page.isClosed()) return false;
  return session.page.locator(selector).first().isVisible();
};

export const appCount: BrowserCommand<[selector: string]> = async (
  { sessionId },
  selector
) => {
  const session = appSessions.get(sessionId);
  if (!session || session.page.isClosed()) return 0;
  return session.page.locator(selector).count();
};

export const appWaitForSelector: BrowserCommand<
  [selector: string, options?: { hasText?: string; timeout?: number }]
> = async ({ sessionId }, selector, options = {}) => {
  const session = requireAppSession(sessionId);
  if (options.hasText !== undefined) {
    // The old files passed `{ hasText }` where waitForSelector has no such
    // option; a locator wait is the faithful equivalent.
    await locatorFor(session, selector, options)
      .first()
      .waitFor({ state: "visible", timeout: options.timeout });
  } else {
    await session.page.waitForSelector(selector, { timeout: options.timeout });
  }
};

export const appWaitForFunction: BrowserCommand<
  [fn: string, arg?: unknown, options?: { timeout?: number }]
> = async ({ sessionId }, fn, arg, options = {}) => {
  await requireAppSession(sessionId).page.waitForFunction(
    ({ fn, arg }) => {
      const fnValue = new Function(`return (${fn});`)();
      return fnValue(arg);
    },
    { fn, arg },
    { timeout: options.timeout }
  );
};

export const appWaitForTimeout: BrowserCommand<[ms: number]> = async (
  { sessionId },
  ms
) => {
  await requireAppSession(sessionId).page.waitForTimeout(ms);
};

export const appReload: BrowserCommand = async ({ sessionId }) => {
  await requireAppSession(sessionId).page.reload({
    waitUntil: "domcontentloaded",
  });
};

// Emulate offline on the APP context only: the runner's context (the test
// iframe and its command channel) stays online.
export const appSetOffline: BrowserCommand<[offline: boolean]> = async (
  { sessionId },
  offline
) => {
  await requireAppSession(sessionId).context.setOffline(offline);
};

// Save an app-page screenshot next to the runner's `__screenshots__` output so
// failures carry the app's actual state, not just the vitest runner page.
// (Failure diagnostics only: the committed-pixel-baseline pipeline that used
// to sit beside this command was retired — the visual contract moved to
// Storybook + Percy, see docs/decisions/2026-09-01-visual-testing-storybook-percy.md.)
export const appScreenshot: BrowserCommand<[name: string]> = async (
  { project, sessionId },
  name
) => {
  const session = appSessions.get(sessionId);
  if (!session || session.page.isClosed()) return null;
  const file = join(
    project.config.root,
    "__screenshots__",
    "app",
    `${name}-${Date.now()}.png`
  );
  await session.page.screenshot({ path: file });
  return file;
};

// ── helpers (declared after the exports per CONTEXT.md's main-export-first
//    structure; every use is at command-call time, so declaration order is
//    safe) ───────────────────────────────────────────────────────────────────

const appSessions = new Map<string, { page: Page; context: BrowserContext }>();

function requireAppSession(sessionId: string) {
  const session = appSessions.get(sessionId);
  if (!session || session.page.isClosed()) {
    throw new Error("openApp must be called before other app commands");
  }
  return session;
}

// The shared locator construction: every command takes a piercing CSS selector
// with an optional { hasText } scoping option (waitForSelector has no such
// option, so the locator path is the faithful equivalent).
function locatorFor(
  session: { page: Page },
  selector: string,
  options?: { hasText?: string }
) {
  return session.page.locator(
    selector,
    options?.hasText !== undefined ? { hasText: options.hasText } : undefined
  );
}
