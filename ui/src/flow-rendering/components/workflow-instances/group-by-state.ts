/** @private — only imported by workflow-instances.ts */

export type StateColumn<TEntry> = {
  id: string;
  label: string;
  category: string;
  entries: TEntry[];
};

// Groups a workflow's instances into columns by currentState, in the order the
// workflow declares its states. Empty states produce empty columns so the full
// lifecycle stays visible (the board is a derived view of instance state).
export function groupInstancesByState<
  TEntry extends { state: { currentState: string } },
>(
  states: readonly { id: string; label: string; category?: string }[],
  entries: readonly TEntry[]
): StateColumn<TEntry>[] {
  const entriesByState = new Map<string, TEntry[]>();
  for (const entry of entries) {
    const list = entriesByState.get(entry.state.currentState) ?? [];
    list.push(entry);
    entriesByState.set(entry.state.currentState, list);
  }
  return states.map((state) => ({
    id: state.id,
    label: state.label,
    category: state.category ?? "active",
    entries: entriesByState.get(state.id) ?? [],
  }));
}
