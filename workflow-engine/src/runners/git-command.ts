import { execFileSync } from "node:child_process";

const MAX_BUFFER = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT = 30_000;

// Shared git execution for the git-capable operations. Each caller passes its
// own timeout: real operations get a generous budget, best-effort checks (e.g.
// "does this branch exist?") a short one so they never block on a hung git.
export function runGit(
  cwd: string,
  args: string[],
  timeout = DEFAULT_TIMEOUT
): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout,
    maxBuffer: MAX_BUFFER,
  }).trim();
}

// Best-effort git command: returns false instead of throwing when the command
// fails (a branch that does not exist, a diff that is empty, ...).
export function gitSucceeds(
  cwd: string,
  args: string[],
  timeout = 5_000
): boolean {
  try {
    runGit(cwd, args, timeout);
    return true;
  } catch {
    return false;
  }
}
