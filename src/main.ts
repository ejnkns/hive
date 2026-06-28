import { hiveCore } from "./hive-core";
import { createServer, listen, SERVER_CONFIG } from "./server";
import { printBanner } from "./shared/logger/ascii-banner";

printBanner();

const server = await createServer();
listen(server, SERVER_CONFIG);

hiveCore.start();

process.on("SIGINT", () => {
  hiveCore.shutdown();
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  hiveCore.shutdown();
  server.close(() => process.exit(0));
});

export { server as _server, hiveCore as _hiveCore };
