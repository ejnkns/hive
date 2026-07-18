/** @private — only imported by worker-supervisor.ts */

import type { WorkerHandover } from "shared/board-types";

export function parseWorkerHandover(
  content: string
): Omit<WorkerHandover, "occurredAt"> | null {
  const handover = content.match(/(?:^|\n)HANDOVER\s*\n([\s\S]*)$/i);
  if (!handover) return null;

  const sections = parseSections(handover[1]);
  const problem = sections.get("PROBLEM")?.[0];
  if (!problem) return null;

  return {
    problem,
    attempted: sections.get("ATTEMPTED") ?? [],
    blockedBy: sections.get("BLOCKED_BY") ?? [],
  };
}

function parseSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | undefined;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/```/g, "").trim();
    if (!line) continue;

    const heading = line.match(/^(PROBLEM|ATTEMPTED|BLOCKED_BY):\s*(.*)$/i);
    if (heading) {
      current = heading[1].toUpperCase();
      sections.set(current, heading[2] ? [heading[2].trim()] : []);
      continue;
    }

    if (current) {
      sections.get(current)?.push(line.replace(/^[-*]\s*/, "").trim());
    }
  }

  return sections;
}
