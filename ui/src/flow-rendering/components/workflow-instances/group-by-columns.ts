/** @private — only imported by workflow-instances.ts */

export type BoardColumn<TEntry> = {
  id: string;
  label: string;
  category: string;
  entries: TEntry[];
};

// Groups a workflow's instances into curated board columns declared by the
// definition (WorkflowConfig.ui.columns). Each instance lands in the column
// that lists its current state; columns render in declaration order. States no
// column lists fall into a trailing "Other" column so nothing disappears from
// the board (an empty Other column still renders when a state is uncurated, so
// definition authors see the gap). A column's category derives from the first
// declared member state that carries one; default "active".
export function groupInstancesByColumns<
  TEntry extends { state: { currentState: string } },
>(
  states: readonly { id: string; label: string; category?: string }[],
  columns: readonly {
    id: string;
    label: string;
    states: readonly string[];
  }[],
  entries: readonly TEntry[]
): BoardColumn<TEntry>[] {
  const entriesByState = new Map<string, TEntry[]>();
  for (const entry of entries) {
    const list = entriesByState.get(entry.state.currentState) ?? [];
    list.push(entry);
    entriesByState.set(entry.state.currentState, list);
  }
  const stateById = new Map(states.map((state) => [state.id, state]));
  const declared = new Set<string>();
  const result: BoardColumn<TEntry>[] = columns.map((column) => {
    for (const stateId of column.states) declared.add(stateId);
    const category =
      column.states
        .map((stateId) => stateById.get(stateId)?.category)
        .find((category) => category !== undefined) ?? "active";
    const columnEntries = column.states.flatMap(
      (stateId) => entriesByState.get(stateId) ?? []
    );
    return {
      id: column.id,
      label: column.label,
      category,
      entries: columnEntries,
    };
  });
  const uncuratedStates = states.filter((state) => !declared.has(state.id));
  if (uncuratedStates.length > 0) {
    result.push({
      id: "other",
      label: "Other",
      category: "active",
      entries: entries.filter(
        (entry) => !declared.has(entry.state.currentState)
      ),
    });
  }
  return result;
}
