import { hiveCore } from "./engine.js";
import { createServer, listen } from "./hive/create-server.js";
import { loadConfig } from "./hive/load-config.js";
import { printBanner } from "./hive/shared/logger.js";

const config = loadConfig();
const server = createServer(config);

listen(server, config);
printBanner();
hiveCore.start();

export { server, hiveCore };
