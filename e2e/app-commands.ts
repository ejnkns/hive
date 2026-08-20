import type { BrowserContext, Page } from "playwright";
import type { BrowserCommand } from "vitest/node";
import "@vitest/browser-playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { PNG } from "pngjs";

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

// --- Visual regression (ticket 10) -------------------------------------------
//
// Screenshot baseline comparison for the app page. The app under test lives in
// a SECOND page (a sibling context of the runner's), so vitest's own
// toHaveScreenshot cannot see it, and `toMatchFileSnapshot` cannot carry binary
// buffers here: the command channel serializes return values to JSON-ish text
// (a Buffer comes back as a plain object) and vitest's raw snapshot files are
// written/read as utf-8 strings, so a PNG round-trips only as its text
// serialization — never as real image bytes. The screenshot + comparison
// therefore both happen on the Node side, in this command:
//
//   * `page.screenshot()` captures the app page (deterministic: Playwright
//     freezes CSS animations and hides the caret by default, viewport is the
//     fixed 1280x720 default of the app context).
//   * The committed baseline is a real PNG under
//     e2e/browser/__image_snapshots__/<name>.png (tracked, reviewable as an
//     image in the repo/PR — NOT gitignored like __screenshots__/).
//   * The capture waits for the render to SETTLE (two consecutive captures
//     within tolerance; see below): the wayfinder theme's --wf-* colors blend
//     over --dur-slow (400ms) after a theme cycle, and the computed style
//     reaches its final value before the paint does, so a capture taken right
//     after a cycle lands mid-blend.
//   * Comparison is pixel-based with a small tolerance: headless Chromium
//     re-rasterizes the served surface's SVG contour strokes (1px strokes under
//     preserveAspectRatio="none" non-uniform scaling) with ±1 channel
//     antialiasing jitter between rasterizations — invisible, but it makes
//     byte-exact comparison flaky. The thresholds (max channel delta 8,
//     ≤ 0.05% differing pixels) absorb that jitter with ~8x headroom while any
//     real visual regression (theme colors, fog order, layout shift, content
//     change) produces deltas far above them. On mismatch the actual render is
//     saved next to the runner's gitignored __screenshots__/ output and both
//     paths + the pixel stats are reported.
//   * Recording/update is explicit: run vitest with `-u` (snapshot update
//     mode, same muscle memory as toMatchSnapshot) or set
//     E2E_UPDATE_SCREENSHOTS=1. A MISSING baseline is a hard failure with
//     instructions — the suite never silently creates baselines from a
//     possibly-broken render.
const BASELINE_DIR = "browser/__image_snapshots__";

export type AppAssertScreenshotOptions = {
  // Capture the element the piercing selector matches (its bounding box)
  // instead of the whole viewport. Useful when the subject sits below the fold
  // or when the rest of the page is not part of the contract.
  element?: string;
};

// Absorbs the headless-SVG stroke AA jitter (see the header comment). Any
// pixel whose max channel delta exceeds MAX_CHANNEL_DELTA, or more than
// MAX_DIFFERING_RATIO of pixels differing at all, is a real change.
const MAX_CHANNEL_DELTA = 8;
const MAX_DIFFERING_RATIO = 0.0005;

// Pixel comparison with tolerance. Returns the diff stats; the caller decides
// pass/fail from them.
function comparePixels(expected: Buffer, actual: Buffer) {
  const a = PNG.sync.read(expected);
  const b = PNG.sync.read(actual);
  if (a.width !== b.width || a.height !== b.height) {
    return {
      sameSize: false as const,
      widthA: a.width,
      heightA: a.height,
      widthB: b.width,
      heightB: b.height,
    };
  }
  let differing = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.data.length; i += 1) {
    const delta = Math.abs(a.data[i] - b.data[i]);
    if (delta > maxDelta) maxDelta = delta;
    // Count a pixel once when any of its four channels differ.
    if (i % 4 === 0) {
      const off = i;
      const d =
        Math.abs(a.data[off] - b.data[off]) +
        Math.abs(a.data[off + 1] - b.data[off + 1]) +
        Math.abs(a.data[off + 2] - b.data[off + 2]) +
        Math.abs(a.data[off + 3] - b.data[off + 3]);
      if (d > 0) differing += 1;
    }
  }
  const total = a.width * a.height;
  return {
    sameSize: true as const,
    differing,
    differingRatio: differing / total,
    maxDelta,
    total,
  };
}

export const appAssertScreenshot: BrowserCommand<
  [name: string, options?: AppAssertScreenshotOptions]
> = async ({ project, sessionId }, name, options = {}) => {
  const session = appSessions.get(sessionId);
  if (!session || session.page.isClosed()) {
    throw new Error("openApp must be called before appAssertScreenshot");
  }
  const capture = () =>
    options.element
      ? session.page.locator(options.element).first().screenshot()
      : session.page.screenshot();

  // Wait for the paint to settle: keep capturing until two consecutive
  // captures are within tolerance of each other (the theme blend and any
  // trailing re-render must finish; the headless SVG AA jitter stays within
  // tolerance, so it does not block settling). Bounded to ~2.5s.
  let prev = await capture();
  let actual = prev;
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cur = await capture();
    const stats = comparePixels(prev, cur);
    if (
      stats.sameSize &&
      stats.maxDelta <= MAX_CHANNEL_DELTA &&
      stats.differingRatio <= MAX_DIFFERING_RATIO
    ) {
      actual = cur;
      break;
    }
    prev = cur;
    actual = cur;
  }

  const baselineFile = join(project.config.root, BASELINE_DIR, `${name}.png`);
  const recording =
    process.env.E2E_UPDATE_SCREENSHOTS === "1" ||
    project.serializedConfig.snapshotOptions.updateSnapshot === "all";

  if (recording) {
    mkdirSync(dirname(baselineFile), { recursive: true });
    writeFileSync(baselineFile, actual);
    return { status: "recorded", file: baselineFile, bytes: actual.length };
  }

  if (!existsSync(baselineFile)) {
    throw new Error(
      `no screenshot baseline at ${relative(project.config.root, baselineFile)}. ` +
        "Record one with `pnpm exec vitest run --config e2e/vitest.config.ts -u " +
        "[file]` (or E2E_UPDATE_SCREENSHOTS=1)."
    );
  }

  const expected = readFileSync(baselineFile);
  const stats = comparePixels(expected, actual);
  const pass =
    stats.sameSize &&
    stats.maxDelta <= MAX_CHANNEL_DELTA &&
    stats.differingRatio <= MAX_DIFFERING_RATIO;
  if (pass) {
    return {
      status: "matched",
      file: baselineFile,
      bytes: actual.length,
      maxDelta: stats.maxDelta,
      differingRatio: stats.differingRatio,
    };
  }

  // Keep the actual render for visual diffing (gitignored __screenshots__ dir).
  const actualFile = join(
    project.config.root,
    "__screenshots__",
    "app",
    `${name}-actual-${Date.now()}.png`
  );
  mkdirSync(dirname(actualFile), { recursive: true });
  writeFileSync(actualFile, actual);
  const detail = stats.sameSize
    ? `${(stats.differingRatio * 100).toFixed(3)}% pixels differ (${stats.differing} of ${stats.total}), max channel delta ${stats.maxDelta} (tolerance: delta <= ${MAX_CHANNEL_DELTA}, ratio <= ${(MAX_DIFFERING_RATIO * 100).toFixed(3)}%)`
    : `sizes differ: baseline ${stats.widthA}x${stats.heightA}, actual ${stats.widthB}x${stats.heightB}`;
  throw new Error(
    `screenshot "${name}" differs from its baseline:\n` +
      `  baseline: ${relative(project.config.root, baselineFile)} (${expected.length} bytes)\n` +
      `  actual:   ${relative(project.config.root, actualFile)} (${actual.length} bytes)\n` +
      `  ${detail}\n` +
      "Review the actual against the baseline; if the new render is intended, " +
      "re-record with `vitest run -u`."
  );
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
