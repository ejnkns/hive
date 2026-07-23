import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const HIVE_DATA_DIR_BACKUP = process.env.HIVE_DATA_DIR;
const tempDir = mkdtempSync(join(tmpdir(), "hive-model-priority-test-"));

process.env.HIVE_DATA_DIR = tempDir;

const configFilePath = join(tempDir, "model-priority.json");

function writeConfigFile(content: unknown) {
  writeFileSync(configFilePath, JSON.stringify(content, null, 2), "utf-8");
}

function removeConfigFile() {
  if (existsSync(configFilePath)) {
    rmSync(configFilePath);
  }
}

await describe("model-priority-config", async () => {
  beforeEach(() => {
    removeConfigFile();
  });

  after(() => {
    removeConfigFile();
    rmSync(tempDir, { recursive: true, force: true });
    process.env.HIVE_DATA_DIR = HIVE_DATA_DIR_BACKUP;
  });

  await it("getModelPriority returns null when no file exists", async () => {
    const { getModelPriority, loadModelPriority } = await import(
      "./model-priority-config"
    );
    loadModelPriority();
    assert.strictEqual(getModelPriority(), null);
  });

  await it("loads valid config with modelPriority only", async () => {
    writeConfigFile({
      modelPriority: ["deepseek-v4-pro", "gpt-4o-mini"],
    });

    const { getModelPriority, loadModelPriority } = await import(
      "./model-priority-config"
    );
    loadModelPriority();

    const config = getModelPriority();
    assert.notStrictEqual(config, null);
    assert.deepEqual(config?.modelPriority, ["deepseek-v4-pro", "gpt-4o-mini"]);
    assert.strictEqual(config?.providerPriority, undefined);
  });

  await it("loads valid config with providerPriority", async () => {
    writeConfigFile({
      modelPriority: ["model-a"],
      providerPriority: ["prov-a", "prov-b"],
    });

    const { getModelPriority, loadModelPriority } = await import(
      "./model-priority-config"
    );
    loadModelPriority();

    const config = getModelPriority();
    assert.notStrictEqual(config, null);
    assert.deepEqual(config?.providerPriority, ["prov-a", "prov-b"]);
  });

  await it("rejects missing modelPriority", async () => {
    writeConfigFile({ notModelPriority: [] });

    const { getModelPriority, loadModelPriority } = await import(
      "./model-priority-config"
    );
    loadModelPriority();

    assert.strictEqual(getModelPriority(), null);
  });

  await it("rejects empty modelPriority", async () => {
    writeConfigFile({ modelPriority: [] });

    const { getModelPriority, loadModelPriority } = await import(
      "./model-priority-config"
    );
    loadModelPriority();

    assert.strictEqual(getModelPriority(), null);
  });

  await it("rejects non-array providerPriority", async () => {
    writeConfigFile({
      modelPriority: ["model-a"],
      providerPriority: "not-an-array",
    });

    const { getModelPriority, loadModelPriority } = await import(
      "./model-priority-config"
    );
    loadModelPriority();

    assert.strictEqual(getModelPriority(), null);
  });

  await it("handles malformed JSON", async () => {
    writeFileSync(configFilePath, "not valid json {{", "utf-8");

    const { getModelPriority, loadModelPriority } = await import(
      "./model-priority-config"
    );
    loadModelPriority();

    assert.strictEqual(getModelPriority(), null);
  });

  await it("rejects non-object JSON root", async () => {
    writeFileSync(configFilePath, '"just a string"', "utf-8");

    const { getModelPriority, loadModelPriority } = await import(
      "./model-priority-config"
    );
    loadModelPriority();

    assert.strictEqual(getModelPriority(), null);
  });
});
