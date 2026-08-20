import type { Page } from "playwright";
import type { BrowserCommand } from "vitest/node";
import "@vitest/browser-playwright";
import { join } from "node:path";

// The app under test cannot live in the vitest test iframe: browser-mode tests
// execute inside an iframe on the runner's page, and navigating that page to
// the external app would destroy the iframe (and the running test with it).
// So each test session gets a SECOND page in the same browser, created here on
// the Node side, and the tests drive it through these custom commands
// (`vitest/browser` `commands`). Playwright locators/auto-wait apply to every
// command; tests add auto-retry on top with `expect.poll`.
const appPages = new Map<string, Page>();

function requireAppPage(sessionId: string): Page {
  const appPage = appPages.get(sessionId);
  if (!appPage || appPage.isClosed()) {
    throw new Error("openApp must be called before other app commands");
  }
  return appPage;
}

// Navigate the session's app page to the given URL, creating it on first use.
export const openApp: BrowserCommand<[url: string]> = async (
  { context, sessionId },
  url
) => {
  let appPage = appPages.get(sessionId);
  if (!appPage || appPage.isClosed()) {
    appPage = await context.newPage();
    appPages.set(sessionId, appPage);
  }
  await appPage.goto(url, { waitUntil: "domcontentloaded" });
};

// Create a flow instance through the built server's API, from the app page's
// origin. Mirrors the old harness's in-page `fetch("/api/flows")`.
export const createFlow: BrowserCommand<
  [definitionId: string, config: Record<string, unknown>]
> = async ({ sessionId }, definitionId, config) => {
  const appPage = requireAppPage(sessionId);
  const origin = new URL(appPage.url()).origin;
  const response = await fetch(`${origin}/api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definitionId, config }),
  });
  return response.json();
};

export const appClick: BrowserCommand<[selector: string]> = async (
  { sessionId },
  selector
) => {
  await requireAppPage(sessionId).locator(selector).first().click();
};

export const appIsVisible: BrowserCommand<[selector: string]> = async (
  { sessionId },
  selector
) => {
  const appPage = appPages.get(sessionId);
  if (!appPage || appPage.isClosed()) return false;
  return appPage.locator(selector).first().isVisible();
};

export const appCount: BrowserCommand<[selector: string]> = async (
  { sessionId },
  selector
) => {
  const appPage = appPages.get(sessionId);
  if (!appPage || appPage.isClosed()) return 0;
  return appPage.locator(selector).count();
};

export const appReload: BrowserCommand = async ({ sessionId }) => {
  await requireAppPage(sessionId).reload({ waitUntil: "domcontentloaded" });
};

// Save an app-page screenshot next to the runner's `__screenshots__` output so
// failures carry the app's actual state, not just the vitest runner page.
export const appScreenshot: BrowserCommand<[name: string]> = async (
  { project, sessionId },
  name
) => {
  const appPage = appPages.get(sessionId);
  if (!appPage || appPage.isClosed()) return null;
  const file = join(
    project.config.root,
    "__screenshots__",
    "app",
    `${name}-${Date.now()}.png`
  );
  await appPage.screenshot({ path: file });
  return file;
};
