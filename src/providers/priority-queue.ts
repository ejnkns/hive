import type { ProviderState } from './registry'

export function sortByPriority(states: ProviderState[]): ProviderState[] {
  return [...states].sort((a, b) => b.stabilityScore - a.stabilityScore)
}
