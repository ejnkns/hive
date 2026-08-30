import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const HIVE_DIR = process.env.HIVE_DATA_DIR
  ? resolve(process.env.HIVE_DATA_DIR)
  : join(homedir(), ".hive");

// The hive data dir resolved at call time: the const above is frozen at
// import, so a test that wants to redirect the location (e.g. to a temp dir)
// cannot re-import it — this resolver reads the env var when called.
export function resolveHiveDir(): string {
  return process.env.HIVE_DATA_DIR
    ? resolve(process.env.HIVE_DATA_DIR)
    : HIVE_DIR;
}
