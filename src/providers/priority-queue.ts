import type { ProviderState } from '../providers.js'

export function sortByPriority(states: ProviderState[]): ProviderState[] {
  return [...states].sort((a, b) => b.stabilityScore - a.stabilityScore)
}

export function updateScore(
  states: ProviderState[],
  providerName: string,
  model: string,
  newScore: number,
): ProviderState[] {
  return states.map((s) =>
    s.provider === providerName && s.model === model
      ? { ...s, stabilityScore: newScore }
      : s,
  )
}
