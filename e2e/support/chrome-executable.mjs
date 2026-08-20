import { accessSync, constants } from "node:fs";

// Resolve the system Chrome/Chromium the e2e browser runs on, so the suite
// never downloads a browser. Shared by the node --test harness (which launches
// Chrome itself) and the Vitest browser-mode config (which passes it to the
// Playwright provider's launchOptions). Kept free of `import.meta.url` so the
// Vitest config loader can bundle it safely.
export function chromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next supported system browser path.
    }
  }
  throw new Error(
    "Hive E2E requires Chrome/Chromium or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"
  );
}
