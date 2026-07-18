import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

const repositoryPath = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  readFileSync(join(repositoryPath, "package.json"), "utf-8")
);
const executable = join(repositoryPath, "server", "dist", "main.mjs");
const runtimePath = mkdtempSync(join(tmpdir(), "hive-built-server-"));
const port = await reserveAvailablePort();
const environment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !name.endsWith("_API_KEY") && !name.endsWith("_TOKEN")
  )
);

environment.DOTENV_CONFIG_PATH = join(runtimePath, "missing.env");
environment.HIVE_DATA_DIR = join(runtimePath, ".hive");
environment.NO_COLOR = "1";

const child = spawn(
  process.execPath,
  [executable, "start", "--host", "127.0.0.1", "--port", String(port)],
  {
    cwd: runtimePath,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  }
);

let output = "";
child.stdout.on("data", collectOutput);
child.stderr.on("data", collectOutput);

try {
  await waitForHealth(port, child, () => output);

  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: "ok" });

  const uiResponse = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(uiResponse.status, 200);
  assert.match(await uiResponse.text(), /<div id="app"><\/div>/);

  const webSocketResponse = await openWebSocket(port);
  assert.match(webSocketResponse, /^HTTP\/1\.1 101 Switching Protocols/m);

  assert.equal(packageJson.scripts?.start, "node server/dist/main.mjs start");
  assert.equal(packageJson.bin?.hive, "server/dist/main.mjs");

  console.log(`built server smoke passed on port ${port}`);
} finally {
  child.kill("SIGTERM");
  await waitForExit(child);
  rmSync(runtimePath, { recursive: true, force: true });
}

function collectOutput(chunk) {
  output += String(chunk);
}

async function reserveAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const availablePort = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return availablePort;
}

async function waitForHealth(serverPort, serverProcess, readOutput) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Built server exited early.\n${readOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Built server did not become healthy.\n${readOutput()}`);
}

function openWebSocket(serverPort) {
  return new Promise((resolve, reject) => {
    const socket = connect(serverPort, "127.0.0.1");
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Built server WebSocket upgrade timed out"));
    }, 2_000);

    socket.on("connect", () => {
      socket.write(
        [
          "GET /ws HTTP/1.1",
          `Host: 127.0.0.1:${serverPort}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Origin: http://127.0.0.1",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "",
          "",
        ].join("\r\n")
      );
    });
    socket.on("data", (chunk) => {
      response += String(chunk);
      if (response.includes("\r\n\r\n")) {
        clearTimeout(timeout);
        socket.destroy();
        resolve(response);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForExit(childProcess) {
  if (childProcess.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => childProcess.once("exit", resolve));
}
