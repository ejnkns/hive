import { hiveCore } from "./engine";
import { createServer, listen } from "./hive/create-server";
import { SERVER_CONFIG } from "./hive/server-config";
import { printBanner } from "./hive/shared/logger/ascii-banner";

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

export { server, hiveCore };
