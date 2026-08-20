// The organize workflow's build_map operation, referenced by the honeycomb
// flow definition. Renders the organized map.md: grouped by category,
// ordered by priority. The returned string is what the task's persist path
// writes (string output becomes a text file).

import {
  defineOperations,
  type OperationContext,
} from "workflow-engine/runners";
import type { TaskDefinition } from "workflow-engine/task-runner";
import type { OrganizeState } from "../types.ts";

const PRIORITY_ORDER = ["p0", "p1", "p2", "p3", "p4"] as const;

type IdeaView = {
  title: string;
  category: string;
  priority: string;
  effort: string;
  status: string;
  tags: string[];
  summary: string;
};

export const build_mapOperations = defineOperations<OrganizeState>({
  build_map: (
    _task: TaskDefinition,
    _params: Record<string, unknown>,
    ctx: OperationContext<OrganizeState>
  ) => {
    const ideas = ctx.workflowInstancesInState("ideas");
    const classified = ideas
      .map((i) => i.workflowInstanceState as unknown as IdeaView)
      .filter((i) => typeof i.category === "string" && i.category !== "");

    const byCategory = new Map<string, IdeaView[]>();
    for (const idea of classified) {
      const list = byCategory.get(idea.category) ?? [];
      list.push(idea);
      byCategory.set(idea.category, list);
    }

    const lines: string[] = [
      "# Ideas Map",
      "",
      `Organized ${classified.length} ideas across ${byCategory.size} categories by the honeycomb flow.`,
      "",
    ];
    for (const [category, bucket] of byCategory) {
      lines.push(`## ${category}`, "");
      for (const idea of [...bucket].sort(byPriorityThenTitle)) {
        lines.push(renderIdea(idea));
      }
      lines.push("");
    }
    return lines.join("\n");
  },
});

function byPriorityThenTitle(a: IdeaView, b: IdeaView): number {
  const rankA = priorityRank(a.priority);
  const rankB = priorityRank(b.priority);
  if (rankA !== rankB) return rankA - rankB;
  return String(a.title).localeCompare(String(b.title));
}

function priorityRank(priority: string | undefined): number {
  const index = PRIORITY_ORDER.indexOf(
    priority as (typeof PRIORITY_ORDER)[number]
  );
  return index === -1 ? PRIORITY_ORDER.length : index;
}

function renderIdea(idea: IdeaView): string {
  const tags =
    idea.tags !== undefined && idea.tags.length > 0
      ? ` [${idea.tags.join(", ")}]`
      : "";
  const line = `- **${idea.title}** — ${idea.priority ?? "?"}/${
    idea.effort ?? "?"
  }${tags}`;
  return idea.summary ? `${line}\n  ${idea.summary}` : line;
}
