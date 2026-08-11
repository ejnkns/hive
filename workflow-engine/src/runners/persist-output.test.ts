import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { persistOutput } from "./persist-output.ts";

describe("persistOutput", () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a string as a text file", () => {
    root = mkdtempSync(join(tmpdir(), "persist-"));
    const target = persistOutput({
      output: "hello world",
      persistPath: "notes.txt",
      basePath: root,
      domainDir: ".flow",
      instanceId: "i1",
      attempt: 1,
    });
    assert.equal(target, join(root, ".flow", "notes.txt"));
    assert.equal(readFileSync(target, "utf-8"), "hello world");
  });

  it("writes an object as JSON without a kind field", () => {
    root = mkdtempSync(join(tmpdir(), "persist-"));
    const target = persistOutput({
      output: { name: "pkg", count: 3 },
      persistPath: "meta.json",
      basePath: root,
      domainDir: ".flow",
      instanceId: "i1",
      attempt: 1,
    });
    assert.deepEqual(JSON.parse(readFileSync(target, "utf-8")), {
      name: "pkg",
      count: 3,
    });
  });

  it("substitutes {instanceId} and {attempt} in the path", () => {
    root = mkdtempSync(join(tmpdir(), "persist-"));
    const target = persistOutput({
      output: { verdict: "approved" },
      persistPath: "reviews/{instanceId}-{attempt}.json",
      basePath: root,
      domainDir: ".flow",
      instanceId: "card-9",
      attempt: 2,
    });
    assert.equal(target, join(root, ".flow", "reviews", "card-9-2.json"));
    assert.ok(existsSync(target));
  });

  it("creates nested directories and leaves no temp file", () => {
    root = mkdtempSync(join(tmpdir(), "persist-"));
    const target = persistOutput({
      output: { ok: true },
      persistPath: "reviews/{instanceId}/package.json",
      basePath: root,
      domainDir: ".flow",
      instanceId: "card-9",
      attempt: 1,
    });
    assert.ok(existsSync(target));
    const leftovers = readdirSync(join(root, ".flow", "reviews")).filter((f) =>
      f.endsWith(".tmp")
    );
    assert.deepEqual(leftovers, []);
  });

  it("rejects absolute persist paths", () => {
    root = mkdtempSync(join(tmpdir(), "persist-"));
    assert.throws(() =>
      persistOutput({
        output: "x",
        persistPath: "/etc/evil",
        basePath: root,
        domainDir: ".flow",
        instanceId: "i1",
        attempt: 1,
      })
    );
  });

  it("rejects persist paths that escape the domain root", () => {
    root = mkdtempSync(join(tmpdir(), "persist-"));
    assert.throws(() =>
      persistOutput({
        output: "x",
        persistPath: "../outside.txt",
        basePath: root,
        domainDir: ".flow",
        instanceId: "i1",
        attempt: 1,
      })
    );
  });
});
