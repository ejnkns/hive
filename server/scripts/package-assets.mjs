import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverPath = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryPath = dirname(serverPath);
const uiBuildPath = join(repositoryPath, "ui", "dist", "ui");
const staticPath = join(repositoryPath, "static");
const outputPath = join(serverPath, "dist");

if (!existsSync(uiBuildPath)) {
  throw new Error(`UI build not found at ${uiBuildPath}`);
}

cpSync(uiBuildPath, join(outputPath, "ui"), { recursive: true });
cpSync(staticPath, join(outputPath, "static"), { recursive: true });
