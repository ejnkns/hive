// The shared app-driving surface for the migrated e2e files. The app under
// test runs in a second page of the same browser (see e2e/app-commands.ts);
// this wrapper exposes the custom `commands` as `app.*` calls so the ported
// files read `app.evaluate(...)` / `app.click(...)` / `app.waitForTimeout(...)`
// instead of the old harness's `page.evaluate(...)` / `page.locator(...).click()`.
//
// Page code (app.evaluate, app.waitForFunction) is serialized to a string:
// functions do not cross the command channel, so they are sent as their source
// and evaluated inside the app page by the command.
import { commands } from "vitest/browser";

function pageCode(fn) {
  return typeof fn === "function" ? fn.toString() : fn;
}

export const app = {
  open: (url) => commands.openApp(url),
  createFlow: (definitionId, config) =>
    commands.createFlow(definitionId, config),
  click: (selector, options) => commands.appClick(selector, options),
  attr: (selector, name, options) => commands.appAttr(selector, name, options),
  dispatch: (selector, eventType, eventInit, options) =>
    commands.appDispatch(selector, eventType, eventInit, options),
  isVisible: (selector) => commands.appIsVisible(selector),
  count: (selector) => commands.appCount(selector),
  fill: (selector, text, options) => commands.appFill(selector, text, options),
  selectOption: (selector, value) => commands.appSelectOption(selector, value),
  textContent: (selector) => commands.appTextContent(selector),
  evaluate: (fn, arg) => commands.appEvaluate(pageCode(fn), arg),
  waitForSelector: (selector, options) =>
    commands.appWaitForSelector(selector, options),
  waitForFunction: (fn, arg, options) =>
    commands.appWaitForFunction(pageCode(fn), arg, options),
  waitForTimeout: (ms) => commands.appWaitForTimeout(ms),
  setOffline: (offline) => commands.appSetOffline(offline),
  reload: () => commands.appReload(),
  screenshot: (name) => commands.appScreenshot(name),
};
