/** @private — only imported by integration-manager.ts */

export type MergeTreeResult =
  | { state: "mergeable"; tree: string }
  | { state: "conflicted"; files: string[] }
  | { state: "error"; message: string };

export function parseMergeTreeResult(input: {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
  signal?: NodeJS.Signals | null;
}): MergeTreeResult {
  if (input.error) {
    return { state: "error", message: input.error.message };
  }
  if (input.signal) {
    return {
      state: "error",
      message: `Git merge analysis ended with signal ${input.signal}`,
    };
  }
  const output = `${input.stdout}\n${input.stderr}`.trim();
  if (input.status === 0) {
    const tree = input.stdout.split("\n")[0]?.trim();
    return tree
      ? { state: "mergeable", tree }
      : { state: "error", message: "Git produced no merged tree" };
  }
  if (input.status === null) {
    return { state: "error", message: output || "Git merge analysis failed" };
  }
  const files = [...output.matchAll(/CONFLICT .* in (.+)$/gm)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  if (output.includes("CONFLICT")) {
    return {
      state: "conflicted",
      files: [...new Set(files)].sort(),
    };
  }
  return {
    state: "error",
    message: output || `Git merge analysis failed with status ${input.status}`,
  };
}
