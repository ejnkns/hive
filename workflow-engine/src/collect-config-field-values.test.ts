import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectConfigFieldValues,
  configFieldValueError,
  configValueMatchesType,
} from "./collect-config-field-values";
import type { ConfigField } from "./workflow-types";

const field = (
  overrides: Partial<ConfigField> & { key: string }
): ConfigField => ({
  label: overrides.key,
  type: "string",
  ...overrides,
});

describe("collectConfigFieldValues", () => {
  it("accepts string/boolean/number and rejects unknown keys", () => {
    const fields: ConfigField[] = [
      field({ key: "title", type: "string", required: true }),
      field({ key: "approved", type: "boolean" }),
      field({ key: "count", type: "number" }),
    ];
    const result = collectConfigFieldValues(fields, {
      title: "Fix totals",
      approved: true,
      count: 3,
    });
    assert.deepEqual(result, {
      ok: true,
      values: { title: "Fix totals", approved: true, count: 3 },
    });

    assert.deepEqual(collectConfigFieldValues(fields, { bogus: 1 }), {
      ok: false,
      error: 'Unknown field "bogus"',
    });
  });

  it("rejects non-finite numbers", () => {
    const fields: ConfigField[] = [field({ key: "count", type: "number" })];
    assert.equal(configValueMatchesType(fields[0], Number.NaN), false);
    assert.equal(
      configValueMatchesType(fields[0], Number.POSITIVE_INFINITY),
      false
    );
  });

  it("treats textarea as a string", () => {
    const fields: ConfigField[] = [
      field({ key: "note", type: "textarea", required: true }),
    ];
    assert.deepEqual(collectConfigFieldValues(fields, { note: "a\nb" }), {
      ok: true,
      values: { note: "a\nb" },
    });
    assert.equal(configValueMatchesType(fields[0], 5), false);
  });

  it("validates date fields as YYYY-MM-DD calendar dates", () => {
    const dateField = field({ key: "due", type: "date" });
    assert.equal(configValueMatchesType(dateField, "2024-08-10"), true);
    assert.equal(configValueMatchesType(dateField, "2024-13-40"), false);
    assert.equal(configValueMatchesType(dateField, "2024-02-30"), false);
    assert.equal(configValueMatchesType(dateField, "10/08/2024"), false);
    assert.equal(configValueMatchesType(dateField, "2024-8-1"), false);
    assert.equal(configValueMatchesType(dateField, 20240810), false);
  });

  it("validates datetime fields as YYYY-MM-DDTHH:mm", () => {
    const dtField = field({ key: "deadline", type: "datetime" });
    assert.equal(configValueMatchesType(dtField, "2024-08-10T14:30"), true);
    assert.equal(configValueMatchesType(dtField, "2024-08-10T14:30:00"), true);
    assert.equal(configValueMatchesType(dtField, "2024-08-10T24:00"), false);
    assert.equal(configValueMatchesType(dtField, "2024-08-10T10:61"), false);
    assert.equal(configValueMatchesType(dtField, "2024-13-40T10:00"), false);
    assert.equal(configValueMatchesType(dtField, "2024-08-10"), false);
    assert.equal(configValueMatchesType(dtField, "2024-08-10 14:30"), false);
  });

  it("collects string[] fields and dedupes on write", () => {
    const fields: ConfigField[] = [
      field({ key: "tags", type: "string[]", required: true }),
    ];
    const result = collectConfigFieldValues(fields, {
      tags: ["a", "b", "a"],
    });
    assert.deepEqual(result, { ok: true, values: { tags: ["a", "b"] } });
    assert.deepEqual(collectConfigFieldValues(fields, { tags: "a" }), {
      ok: false,
      error: 'Field "tags" must be a string[]',
    });
  });

  it("enforces the closed option set for string[] with options", () => {
    const fields: ConfigField[] = [
      field({ key: "tags", type: "string[]", options: ["a", "b"] }),
    ];
    assert.deepEqual(collectConfigFieldValues(fields, { tags: ["a"] }), {
      ok: true,
      values: { tags: ["a"] },
    });
    assert.deepEqual(collectConfigFieldValues(fields, { tags: ["c"] }), {
      ok: false,
      error: 'Field "tags" has values outside the allowed options: c',
    });
  });

  it("reports a specific error for an invalid value", () => {
    const fields: ConfigField[] = [field({ key: "due", type: "date" })];
    assert.equal(
      configFieldValueError(fields[0], "not-a-date"),
      'Field "due" must be a date'
    );
  });

  it("treats an empty required string[] as missing", () => {
    const fields: ConfigField[] = [
      field({ key: "tags", type: "string[]", required: true }),
    ];
    assert.deepEqual(collectConfigFieldValues(fields, { tags: [] }), {
      ok: false,
      error: 'Required field "tags" cannot be empty',
    });
  });

  it("skips absent optional fields", () => {
    const fields: ConfigField[] = [
      field({ key: "note", type: "textarea" }),
      field({ key: "due", type: "date" }),
    ];
    assert.deepEqual(collectConfigFieldValues(fields, {}), {
      ok: true,
      values: {},
    });
  });
});
