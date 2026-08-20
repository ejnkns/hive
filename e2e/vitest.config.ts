import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import {
  appClick,
  appCount,
  appEvaluate,
  appFill,
  appIsVisible,
  appReload,
  appScreenshot,
  appSelectOption,
  appSetOffline,
  appTextContent,
  appWaitForFunction,
  appWaitForSelector,
  appWaitForTimeout,
  createFlow,
  openApp,
} from "./app-commands";
import { chromeExecutable } from "./support/chrome-executable.mjs";

// The e2e suite under Vitest browser mode. Tests execute inside a real browser
// (the repo's system Chrome — no browser downloads) and drive the built
// production server, exactly the contract the node --test runner had. The
// server + mock provider boot on the Node side in ./global-setup.ts (test
// files run in the browser and have no Node APIs) and reach the tests via
// `provide`/`inject`.
//
// The runner's page hosts the test iframe; the app under test runs in a second
// page of the same browser, driven through the custom commands in
// ./app-commands.ts (see its header comment for why).
//
// Migrated files live in e2e/browser/ so the retired `node --test` runner
// (`node --test e2e/*.test.mjs` — top-level files only) never picks them up.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["browser/**/*.test.mjs"],
    globalSetup: ["./global-setup.ts"],
    // Isolation model (ticket 04 note): globalSetup boots ONE server + one
    // mock provider + one temp data dir for the whole run, so all test files
    // share that single stack. Files therefore run sequentially (no parallel
    // stacks to contend) and each file must create uniquely named flows.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          executablePath: chromeExecutable(),
        },
      }),
      instances: [{ browser: "chromium" }],
      screenshotFailures: true,
      commands: {
        openApp,
        createFlow,
        appClick,
        appFill,
        appSelectOption,
        appTextContent,
        appEvaluate,
        appIsVisible,
        appCount,
        appWaitForSelector,
        appWaitForFunction,
        appWaitForTimeout,
        appReload,
        appSetOffline,
        appScreenshot,
      },
    },
  },
});
