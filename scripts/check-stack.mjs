// The stack-register gate: every external dependency in any workspace
// package.json must be documented in docs/stack.md's machine-checked
// manifest, or the commit fails (pre-commit hook; see lefthook.yml and the
// governance header in docs/stack.md).
//
// One-directional by design: an undocumented dependency is a hard failure
// (that is the oversight gate — additions cannot land silently), while a
// documented-but-unused entry is a warning (indirect usage — type packages,
// toolchain peers, planned removals — must not produce false blocks). Stale
// entries are still reported so the register gets cleaned up in the same
// decision that removes the tool.
//
// Workspace-internal specifiers (`workspace:*`) are skipped: the workspace
// packages are the codebase itself, not governed dependencies.

import { readFileSync } from "node:fs";

const main = () => {
  const manifestPath = process.argv[2] ?? "docs/stack.md";
  const documented = readManifest(manifestPath);
  const used = collectWorkspaceDependencies();
  if (used === undefined) process.exit(1);

  const undocumented = [...used].filter((name) => !documented.has(name));
  const stale = [...documented].filter((name) => !used.has(name));

  for (const name of undocumented) {
    console.error(
      `stack-register: '${name}' is used but not documented in ${manifestPath}. ` +
        "Adding a dependency requires a decision record in docs/decisions/ " +
        "approved by ej and an entry in the stack register — stop and file " +
        "the decision instead of installing it."
    );
  }
  for (const name of stale) {
    console.warn(
      `stack-register: '${name}' is documented in ${manifestPath} but not ` +
        "declared by any workspace package.json — remove or annotate the " +
        "entry in the same change that removes the tool."
    );
  }

  if (undocumented.length > 0) process.exit(1);
  console.log(
    `stack-register: ${used.size} dependencies documented, ` +
      `${stale.length} stale warnings.`
  );
};

/** The documented package names from the ```stack fenced block. Throws on a
 * missing or empty block — a rotted register must fail loudly, not pass. */
function readManifest(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    console.error(`stack-register: cannot read ${path}`);
    process.exit(1);
  }
  const match = source.match(/```stack\n([\s\S]*?)```/);
  if (match === null) {
    console.error(`stack-register: no \`\`\`stack manifest block in ${path}`);
    process.exit(1);
  }
  const names = match[1]
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
  if (names.length === 0) {
    console.error(`stack-register: the \`\`\`stack block in ${path} is empty`);
    process.exit(1);
  }
  return new Set(names);
}

/** Every external specifier declared by the workspace: the root package.json
 * plus each package listed in pnpm-workspace.yaml. Returns undefined after
 * reporting a structural problem (missing manifest file, unreadable json). */
function collectWorkspaceDependencies() {
  let packageDirs;
  try {
    const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
    const block = workspace.match(/^packages:\n((?:[ \t]+-[^\n]*\n?)*)/m);
    packageDirs =
      block === null
        ? []
        : [...block[1].matchAll(/-["\s]*([^"\n]+)["\s]*/g)].map((entry) =>
            entry[1].trim()
          );
  } catch {
    console.error("stack-register: cannot read pnpm-workspace.yaml");
    return undefined;
  }

  const used = new Set();
  for (const dir of [".", ...packageDirs]) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
    } catch {
      console.error(`stack-register: cannot read ${dir}/package.json`);
      return undefined;
    }
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        if (String(version).startsWith("workspace:")) continue;
        used.add(name);
      }
    }
  }
  return used;
}

main();
