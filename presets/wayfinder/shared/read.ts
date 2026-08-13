// shared string/array readers for wayfinder operations.

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

// Creation-time input may carry dependsOn as a comma/space-separated id list
// (the Add ticket form); normalize it into the array the engine's
// dependsOnState backstop reads.
export function readDependsOn(value: unknown): string[] {
  if (typeof value === "string" && value !== "") {
    return value
      .split(/[,\s]+/)
      .map((id) => id.trim())
      .filter((id) => id !== "");
  }
  return readStringArray(value);
}
