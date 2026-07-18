import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
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
} finally {
  vite.kill("SIGTERM");
  await closeServer(backend);
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
