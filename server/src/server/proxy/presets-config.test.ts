import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const HIVE_DATA_DIR_BACKUP = process.env.HIVE_DATA_DIR;
const tempDir = mkdtempSync(join(tmpdir(), "hive-presets-test-"));

process.env.HIVE_DATA_DIR = tempDir;

const presetsFilePath = join(tempDir, "presets.json");

function writePresetsFile(content: unknown) {
  writeFileSync(presetsFilePath, JSON.stringify(content, null, 2), "utf-8");
}

function removePresetsFile() {
  if (existsSync(presetsFilePath)) {
    rmSync(presetsFilePath);
  }
}

await describe("presets-config", async () => {
  beforeEach(() => {
    removePresetsFile();
  });

  after(() => {
    removePresetsFile();
    rmSync(tempDir, { recursive: true, force: true });
    process.env.HIVE_DATA_DIR = HIVE_DATA_DIR_BACKUP;
  });

  await it("getPresetsConfig returns null when no file exists", async () => {
    const { getPresetsConfig, loadPresetsConfig } = await import(
      "./presets-config"
    );
    loadPresetsConfig();
    assert.strictEqual(getPresetsConfig(), null);
  });

  await it("loads valid config with modelPriority only", async () => {
    writePresetsFile({
      modelPriority: ["deepseek-v4-pro", "gpt-4o-mini"],
    });

    const { getPresetsConfig, loadPresetsConfig } = await import(
      "./presets-config"
    );
    loadPresetsConfig();

    const config = getPresetsConfig();
    assert.notStrictEqual(config, null);
    assert.deepEqual(config?.modelPriority, ["deepseek-v4-pro", "gpt-4o-mini"]);
    assert.strictEqual(config?.providerPriority, undefined);
  });

  await it("loads valid config with providerPriority", async () => {
    writePresetsFile({
      modelPriority: ["model-a"],
      providerPriority: ["prov-a", "prov-b"],
    });

    const { getPresetsConfig, loadPresetsConfig } = await import(
      "./presets-config"
    );
    loadPresetsConfig();

    const config = getPresetsConfig();
    assert.notStrictEqual(config, null);
    assert.deepEqual(config?.providerPriority, ["prov-a", "prov-b"]);
  });

  await it("rejects missing modelPriority", async () => {
    writePresetsFile({ notModelPriority: [] });

    const { getPresetsConfig, loadPresetsConfig } = await import(
      "./presets-config"
    );
    loadPresetsConfig();

    assert.strictEqual(getPresetsConfig(), null);
  });

  await it("rejects empty modelPriority", async () => {
    writePresetsFile({ modelPriority: [] });

    const { getPresetsConfig, loadPresetsConfig } = await import(
      "./presets-config"
    );
    loadPresetsConfig();

    assert.strictEqual(getPresetsConfig(), null);
  });

  await it("rejects non-array providerPriority", async () => {
    writePresetsFile({
      modelPriority: ["model-a"],
      providerPriority: "not-an-array",
    });

    const { getPresetsConfig, loadPresetsConfig } = await import(
      "./presets-config"
    );
    loadPresetsConfig();

    assert.strictEqual(getPresetsConfig(), null);
  });

  await it("handles malformed JSON", async () => {
    writeFileSync(presetsFilePath, "not valid json {{", "utf-8");

    const { getPresetsConfig, loadPresetsConfig } = await import(
      "./presets-config"
    );
    loadPresetsConfig();

    assert.strictEqual(getPresetsConfig(), null);
  });

  await it("rejects non-object JSON root", async () => {
    writeFileSync(presetsFilePath, '"just a string"', "utf-8");

    const { getPresetsConfig, loadPresetsConfig } = await import(
      "./presets-config"
    );
    loadPresetsConfig();

    assert.strictEqual(getPresetsConfig(), null);
  });
});
