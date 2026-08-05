import type { ProviderPayload } from "shared/dashboard-types";

export type ProviderGroup = {
  name: string;
  displayName: string;
  entries: ProviderPayload[];
  maxScore: number;
  keyConfigured: boolean;
  disabled: boolean;
};

// Groups providers by provider name, ranks each group by its best score, and
// sorts key-configured groups first. Shared by the expanded providers panel and
// its collapsed summary so the two never drift.
export function groupProviders(data: ProviderPayload[]): ProviderGroup[] {
  const grouped = new Map<string, ProviderPayload[]>();
  for (const provider of data) {
    const existing = grouped.get(provider.name);
    if (existing) existing.push(provider);
    else grouped.set(provider.name, [provider]);
  }
  return Array.from(grouped.entries())
    .map(([name, entries]) => {
      const maxScore = Math.max(...entries.map((e) => e.stabilityScore));
      const keyConfigured = entries.some((e) => e.keyConfigured);
      const disabled = entries[0]?.disabled ?? false;
      return {
        name,
        displayName: entries[0].displayName || name,
        entries,
        maxScore,
        keyConfigured,
        disabled,
      };
    })
    .sort((a, b) => {
      if (a.keyConfigured && !b.keyConfigured) return -1;
      if (!a.keyConfigured && b.keyConfigured) return 1;
      return b.maxScore - a.maxScore;
    });
}
