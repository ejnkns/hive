import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

export async function startHiveTestApp(mockProviderHost) {
  const runtimePath = mkdtempSync(join(tmpdir(), "hive-e2e-"));
  const dataPath = join(runtimePath, ".hive");
  const projectPath = createGitProject(runtimePath);
  mkdirSync(dataPath, { recursive: true });
  writeFileSync(
    join(dataPath, "models-cache.json"),
    JSON.stringify({
      lastCheckTime: Date.now(),
      providers: [
        {
          name: "lm-studio",
          modelsEndpoint: `${mockProviderHost}/v1/models`,
          apiKeyEnvVar: "LM_STUDIO_API_KEY",
          models: ["hive-e2e"],
          defaultModel: "hive-e2e",
          lastCheckStatus: "success",
        },
      ],
    })
  );
  const port = await reserveAvailablePort();
  const executable = join(repositoryPath, "server", "dist", "main.mjs");
  accessSync(executable, constants.R_OK);
  const child = spawn(
    process.execPath,
    [executable, "start", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: runtimePath,
      env: isolatedEnvironment({
        HIVE_DATA_DIR: dataPath,
        LM_STUDIO_API_KEY: "hive-e2e-key",
        LM_STUDIO_HOST: mockProviderHost,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  await waitForHealth(port, child, () => output);

  const browser = await chromium.launch({
    executablePath: chromeExecutable(),
    headless: true,
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    output: () => output,
    page,
    projectPath,
    async close() {
      await browser.close();
      child.kill("SIGTERM");
      if (!(await waitForExit(child, 5_000))) {
        child.kill("SIGKILL");
        await waitForExit(child, 5_000);
      }
      rmSync(runtimePath, { recursive: true, force: true });
    },
  };
}

const repositoryPath = dirname(
  dirname(dirname(fileURLToPath(import.meta.url)))
);

function createGitProject(runtimePath) {
  const projectPath = join(runtimePath, "project");
  mkdirSync(join(projectPath, "src"), { recursive: true });
  writeFileSync(join(projectPath, "README.txt"), "Hive E2E project\n");
  writeFileSync(join(projectPath, "src", "app.ts"), "export const app = {};\n");
  git(projectPath, ["init", "--initial-branch", "main"]);
  git(projectPath, ["config", "user.name", "Hive E2E"]);
  git(projectPath, ["config", "user.email", "hive-e2e@example.test"]);
  git(projectPath, ["add", "README.txt", "src/app.ts"]);
  git(projectPath, ["commit", "-m", "Initial commit"]);
  return projectPath;
}

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function isolatedEnvironment(overrides) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.endsWith("_API_KEY") && !name.endsWith("_TOKEN")
      )
    ),
    ...overrides,
    DOTENV_CONFIG_PATH: join(tmpdir(), "hive-e2e-missing.env"),
    NO_COLOR: "1",
  };
}

function chromeExecutable() {
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
    "Queen Bee E2E requires Chrome/Chromium or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"
  );
}

async function reserveAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForHealth(port, child, readOutput) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Hive exited before E2E startup.\n${readOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Keep polling until the startup deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Hive did not become healthy.\n${readOutput()}`);
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
