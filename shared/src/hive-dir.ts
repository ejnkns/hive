import { homedir } from "node:os";
import { join } from "node:path";

export const HIVE_DIR = join(homedir(), ".hive");
