import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryPath = dirname(dirname(fileURLToPath(import.meta.url)));
const backend = createServer();
let upgradeCount = 0;

backend.on("upgrade", (request, socket) => {
  upgradeCount += 1;
  const key = request.headers["sec-websocket-key"];
  assert.equal(typeof key, "string");
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.end(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n")
  );
});

const backendPort = await listenOnAvailablePort(backend);
const uiPort = await reserveAvailablePort();
const vite = spawn(
  join(repositoryPath, "ui", "node_modules", ".bin", "vite"),
  ["--host", "127.0.0.1", "--strictPort", "--clearScreen", "false"],
  {
    cwd: join(repositoryPath, "ui"),
    env: {
      ...process.env,
      HIVE_DEV_SERVER_PORT: String(backendPort),
      HIVE_UI_PORT: String(uiPort),
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);

let viteOutput = "";
vite.stdout.on("data", collectViteOutput);
vite.stderr.on("data", collectViteOutput);

try {
  await waitFor(
    () => viteOutput.includes(`http://127.0.0.1:${uiPort}/`),
    5_000,
    `Vite did not listen on HIVE_UI_PORT=${uiPort}.\n${viteOutput}`
  );

  const response = await openWebSocket(uiPort);
  assert.match(response, /^HTTP\/1\.1 101 Switching Protocols/m);
  assert.equal(upgradeCount, 1, "the backend should receive one upgrade");

  await new Promise((resolve) => setTimeout(resolve, 200));
  const proxyErrors = viteOutput.split("ws proxy error").length - 1;
  assert.ok(
    proxyErrors <= 1,
    `one connection caused ${proxyErrors} WebSocket proxy errors`
  );

  console.log(
    `dev proxy smoke passed: ui=${uiPort}, backend=${backendPort}, upgrades=${upgradeCount}`
  );

  await verifyWatchRootHygiene();
  await verifyTsdownWatchHygiene();
} finally {
  vite.kill("SIGTERM");
  await closeServer(backend);
}

// Watch-root hygiene: agent-written paths (workspaces base, worktrees,
// persisted outputs) must never land in the Vite watch root (ui/src), or an
// agent writing while a long task runs would restart the dev server / trigger
// a full reload mid-run. Writing under such a path must produce no HMR or
// reload output — an .html write is the canary, since a watched .html file
// makes Vite page-reload — while a write under a watched source path still
// does.
async function verifyWatchRootHygiene() {
  const watchRoot = join(repositoryPath, "ui", "src");
  const agentWorkspaceDir = join(
    watchRoot,
    ".hive",
    "workspaces",
    "dev-proxy-smoke",
    "card-1",
    "attempt-1"
  );
  const agentProbe = join(agentWorkspaceDir, "surface.html");
  const watchedProbe = join(watchRoot, "dev-proxy-smoke-probe.html");
  try {
    rmSync(agentWorkspaceDir, { recursive: true, force: true });
    rmSync(watchedProbe, { force: true });

    const outputBeforeAgentWrite = viteOutput.length;
    mkdirSync(agentWorkspaceDir, { recursive: true });
    writeFileSync(agentProbe, "<!doctype html><title>probe</title>\n", "utf-8");
    await new Promise((resolve) => setTimeout(resolve, 700));
    const agentDelta = viteOutput.slice(outputBeforeAgentWrite);
    assert.ok(
      !/page reload|hmr update|restarting server/.test(agentDelta),
      `an agent-workspace write must not restart the dev server or reload, got:\n${agentDelta}`
    );

    const outputBeforeWatchedWrite = viteOutput.length;
    writeFileSync(
      watchedProbe,
      "<!doctype html><title>probe</title>\n",
      "utf-8"
    );
    await waitFor(
      () => viteOutput.slice(outputBeforeWatchedWrite).includes("page reload"),
      5_000,
      `a watched source write must trigger a full reload, got:\n${viteOutput.slice(outputBeforeWatchedWrite)}`
    );

    console.log(
      "dev watch-root hygiene passed: agent-workspace writes ignored, watched writes reload"
    );
  } finally {
    rmSync(agentWorkspaceDir, { recursive: true, force: true });
    rmSync(watchedProbe, { force: true });
    for (const dir of [
      join(watchRoot, ".hive", "workspaces", "dev-proxy-smoke", "card-1"),
      join(watchRoot, ".hive", "workspaces", "dev-proxy-smoke"),
      join(watchRoot, ".hive", "workspaces"),
      join(watchRoot, ".hive"),
    ]) {
      try {
        rmdirSync(dir);
      } catch {
        // non-empty or already gone — best-effort cleanup only
      }
    }
  }
}

// The backend dev server (tsdown --watch) side of watch-root hygiene: the dev
// script re-runs `node ... start` on every rebuild, so an agent write under an
// excluded path must not rebuild (which would restart the dev server mid-run),
// while a write to a watched source file must. Spawns the real tsdown watch
// on the server package and counts its rebuilds. The exclusion is
// prophylactic-by-construction today (server/.runtime is not in the module
// graph), but the observable contract — an agent-path write never rebuilds —
// is exactly what the dev-stability ticket asks for.
async function verifyTsdownWatchHygiene() {
  const serverDir = join(repositoryPath, "server");
  const tsdown = spawn(
    join(serverDir, "node_modules", ".bin", "tsdown"),
    ["--watch", "--clearScreen", "false"],
    {
      cwd: serverDir,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let tsdownOutput = "";
  tsdown.stdout.on("data", (chunk) => (tsdownOutput += String(chunk)));
  tsdown.stderr.on("data", (chunk) => (tsdownOutput += String(chunk)));
  const builds = () => (tsdownOutput.match(/Rebuilt in/g) ?? []).length;

  const probeDir = join(serverDir, ".runtime", "watch-probe");
  const probeFile = join(probeDir, "probe.ts");
  const watchedFile = join(serverDir, "src", "server", "flow-definitions.ts");
  const original = readFileSync(watchedFile, "utf8");

  try {
    await waitFor(
      () => builds() >= 1,
      20_000,
      `tsdown watch did not build:\n${tsdownOutput}`
    );

    const beforeIgnoredWrite = builds();
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(probeFile, "export const probe = 1;\n", "utf-8");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(
      builds(),
      beforeIgnoredWrite,
      `an agent-path write must not rebuild the backend, got:\n${tsdownOutput.slice(-800)}`
    );

    const beforeWatchedWrite = builds();
    writeFileSync(watchedFile, `${original}\n// tsdown-watch-probe\n`, "utf-8");
    await waitFor(
      () => builds() > beforeWatchedWrite,
      20_000,
      `a watched source write must rebuild the backend, got:\n${tsdownOutput.slice(-800)}`
    );

    console.log(
      "tsdown watch-root hygiene passed: agent-path writes ignored, watched writes rebuild"
    );
  } finally {
    writeFileSync(watchedFile, original);
    rmSync(probeDir, { recursive: true, force: true });
    tsdown.kill("SIGTERM");
  }
}

function collectViteOutput(chunk) {
  viteOutput += String(chunk);
}

async function listenOnAvailablePort(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function reserveAvailablePort() {
  const server = createServer();
  const port = await listenOnAvailablePort(server);
  await closeServer(server);
  return port;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function openWebSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("WebSocket upgrade timed out"));
    }, 2_000);

    socket.on("connect", () => {
      socket.write(
        [
          "GET /ws HTTP/1.1",
          `Host: 127.0.0.1:${port}`,
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

async function waitFor(predicate, timeoutMs, message) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
