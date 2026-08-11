// Tool accessibility invariant: from any workspace the flow prepares, the
// agent's standard tools must be able to discover and read the flow's domain
// state (the authoritative spec). This guards the class where an agent
// concluded "no requirements exist" because search_code skipped hidden files
// and list_directory filtered dot-entries.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { prepareIsolatedWorkspace } from "workflow-engine/runners";
import { execute as listDirectory } from "../../../../../workflow-engine/src/runners/create-standard-tool-registry/list-directory.ts";
import { execute as searchCode } from "../../../../../workflow-engine/src/runners/create-standard-tool-registry/search-code.ts";
import { cleanupCardRepo, setupCardRepo } from "./card-flow-harness.ts";

describe("agent tools can see the flow's domain state", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) cleanupCardRepo(root);
  });

  it("search_code and list_directory find .queen-bee from a prepared workspace", async () => {
    const { root, basePath } = setupCardRepo();
    roots.push(root);
    const workspacesBasePath = join(root, "workspaces");

    // Prepare the isolated workspace exactly as the flow does (the engine op),
    // and drop the domain state in as the flow's persistence would.
    const prepared = prepareIsolatedWorkspace({
      basePath,
      workspacesBasePath,
      projectId: "project",
      cardId: "card-1",
      attempt: 1,
      integrationBranch: "queen-bee-main",
      branchPrefix: "queen-bee/",
    });
    assert.equal(prepared.ok, true);
    const workspace = prepared.path;
    assert.ok(workspace);
    mkdirSync(join(workspace, ".queen-bee"));
    writeFileSync(
      join(workspace, ".queen-bee", "requirements.md"),
      "# FR-3 the authoritative spec\n"
    );

    // search_code must find the spec (rg --hidden).
    const search = await searchCode(
      {
        id: "s1",
        name: "search_code",
        arguments: JSON.stringify({ pattern: "FR-3" }),
      },
      { workspacePath: workspace }
    );
    assert.match(search.content, /\.queen-bee\/requirements\.md/);

    // list_directory must surface the domain dir.
    const list = await listDirectory(
      {
        id: "l1",
        name: "list_directory",
        arguments: JSON.stringify({ path: "." }),
      },
      { workspacePath: workspace }
    );
    assert.match(list.content, /\.queen-bee\//);
  });
});
