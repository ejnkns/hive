import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const HIVE_DIR = process.env.HIVE_DATA_DIR
  ? resolve(process.env.HIVE_DATA_DIR)
  : join(homedir(), ".hive");
