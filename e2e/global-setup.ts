import type { TestProject } from "vitest/node";
import { startHiveTestServer } from "./support/hive-test-app.mjs";
import { startMockProvider } from "./support/mock-provider.mjs";

declare module "vitest" {
  interface ProvidedContext {
    baseUrl: string;
    projectPath: string;
  }
}

// Browser-mode test files execute IN the browser: Node APIs (child_process,
// fs, http) are unavailable there, so the built server and the mock provider
// boot here on the Node side of the run, once per vitest run, and the base URL
// reaches the tests via `inject`. The returned function is the teardown.
export default async function setup(project: TestProject) {
  const mock = await startMockProvider();
  const app = await startHiveTestServer(mock.host);
  project.provide("baseUrl", app.baseUrl);
  project.provide("projectPath", app.projectPath);
  return async () => {
    await app.close();
    await mock.close();
  };
}
