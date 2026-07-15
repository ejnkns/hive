import "dotenv/config";
import { cac } from "cac";
import { startServer } from "./main/start-server";

const cli = cac("hive");

cli
  .command("start", "Start the hive proxy")
  .option("--port <port>", "Port to listen on")
  .option("--host <host>", "Host to bind to")
  .action((options) => {
    const port = options.port ? Number(options.port) : undefined;
    // `cac` types options loosely; host is optional string
    const host = options.host as string | undefined;
    startServer({ port, host });
  });

cli.version("0.1.0");
cli.help();
cli.parse();
