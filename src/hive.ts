import { hiveCore } from "./engine";
import { createServer, listen } from "./hive/create-server";
import { loadConfig } from "./hive/load-config";
import { printBanner } from "./hive/shared/logger";

await printBanner();

const config = loadConfig();
const server = createServer(config);

listen(server, config);
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
