/** The no-session files editor's shared tab/save semantics: the tab set is
 * the definition's declared refs ∪ the persisted files (a declared-but-
 * unwritten ref gets an empty tab, like the session editor; a persisted file
 * stays visible even if the current source no longer references it), and the
 * saved file set is the persisted files overlaid with the human's non-empty
 * edits. Pure functions — the session editor (flow-editor.ts) and the shell
 * (DefinitionEditor.svelte) share them. */

// The tab set as a path → content map: every declared ref gets an entry ("" if
// not yet written), then every persisted file not already covered stays.
export function mergeFileTabs(
  declaredRefs: readonly string[],
  existing: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const ref of declaredRefs) {
    merged[ref] = existing[ref] ?? "";
  }
  for (const [path, source] of Object.entries(existing)) {
    if (!(path in merged)) merged[path] = source;
  }
  return merged;
}

// The file set a save submits: the persisted files overlaid with the human's
// edits. The "definition" key is the module source, not a file. An empty edit
// is an unwritten ref — it simply doesn't exist (the module-set gate flags a
// genuinely missing file), so a persisted file emptied by an edit keeps its
// last content rather than saving a broken empty module. `allowed` (optional)
// restricts the edits to a declared set — the new-flow draft only saves refs
// the current source actually declares, never stale tab leftovers.
export function buildFilesPayload(
  persisted: Record<string, string>,
  edits: Record<string, string>,
  allowed?: ReadonlySet<string>
): Record<string, string> {
  const files: Record<string, string> = { ...persisted };
  for (const [path, content] of Object.entries(edits)) {
    if (path === "definition") continue;
    if (content === "") continue;
    if (allowed !== undefined && !allowed.has(path)) continue;
    files[path] = content;
  }
  return files;
}
