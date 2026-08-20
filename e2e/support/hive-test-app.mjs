import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Node-side boot for the Vitest browser-mode runner: the server and mock
// provider must live outside the browser test context (test files execute in
// the browser and have no Node APIs), so globalSetup boots just the server and
// hands the base URL to the tests via `provide`/`inject`.
export async function startHiveTestServer(mockProviderHost) {
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
  assertFreshBuild(executable);
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

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    output: () => output,
    projectPath,
    async close() {
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

// E2E boots the built server and serves whatever package-assets copied. If the
// server bundle or the packaged UI is missing or stale (a dev `tsdown --watch`
// rebuild used to wipe server/dist/ui), every browser test failed at first
// render with a silent "UI not found". Fail fast here instead: verify the
// artifacts exist and are newer than their sources before any server boots.
function assertFreshBuild(executable) {
  const packagedUiIndex = join(
    repositoryPath,
    "server",
    "dist-package",
    "ui",
    "index.html"
  );

  const problems = [];
  if (!isReadableFile(executable)) {
    problems.push(`built server bundle missing: ${executable}`);
  }
  if (!isReadableFile(packagedUiIndex)) {
    problems.push(`packaged UI missing: ${packagedUiIndex}`);
  }
  if (isStaleSince(executable, join(repositoryPath, "server", "src"))) {
    problems.push(
      `server build is stale (server/src is newer than ${executable})`
    );
  }
  if (isStaleSince(packagedUiIndex, join(repositoryPath, "ui", "src"))) {
    problems.push(
      `packaged UI is stale (ui/src is newer than ${packagedUiIndex})`
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `E2E requires a fresh build: run \`pnpm build\` and retry.\n${problems.join(
        "\n"
      )}`
    );
  }
}

function isReadableFile(path) {
  try {
    accessSync(path, constants.R_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isStaleSince(artifact, sourceRoot) {
  if (!isReadableFile(artifact)) return false;
  return newestSourceMtime(sourceRoot) > statSync(artifact).mtimeMs;
}

// Test/spec files are not build inputs; editing one must not flag the build
// as stale.
const NON_BUILD_INPUT = /(\.test\.|\.spec\.)/;

function newestSourceMtime(root) {
  let newest = 0;
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // missing source root — nothing to compare
    }
    for (const entry of entries) {
      if (NON_BUILD_INPUT.test(entry.name)) continue;
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        try {
          const mtime = statSync(entryPath).mtimeMs;
          if (mtime > newest) newest = mtime;
        } catch {
          // Unreadable source file — ignore for freshness.
        }
      }
    }
  }
  return newest;
}

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
