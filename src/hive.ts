import { hiveCore } from "./engine";
import { createServer, listen } from "./hive/create-server";
import { loadConfig } from "./hive/load-config";
import { printBanner } from "./hive/shared/logger";

const config = loadConfig();
const server = createServer(config);

listen(server, config);
printBanner();
hiveCore.start();

export { server, hiveCore };
