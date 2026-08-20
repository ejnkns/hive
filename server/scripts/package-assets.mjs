import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverPath = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryPath = dirname(serverPath);
const uiBuildPath = join(repositoryPath, "ui", "dist", "ui");
const staticPath = join(repositoryPath, "static");
// Package into a sibling of the tsdown output dir: tsdown's `clean: true`
// wipes only server/dist, so a dev `tsdown --watch` rebuild can never delete
// the packaged UI that the e2e suite serves.
const packagedAssetsDir = join(serverPath, "dist-package");

if (!existsSync(uiBuildPath)) {
  throw new Error(`UI build not found at ${uiBuildPath}`);
}

cpSync(uiBuildPath, join(packagedAssetsDir, "ui"), { recursive: true });
cpSync(staticPath, join(packagedAssetsDir, "static"), { recursive: true });
