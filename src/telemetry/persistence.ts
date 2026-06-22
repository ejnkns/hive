import type { ProviderState } from '../providers.js'
import type { RequestMetrics } from './sliding-window.js'

export type TelemetryState = {
  metrics: RequestMetrics[]
  providerStates: ProviderState[]
}

let state: TelemetryState = { metrics: [], providerStates: [] }

export async function loadState(): Promise<TelemetryState> {
  return { ...state, metrics: [...state.metrics], providerStates: [...state.providerStates] }
}

export async function saveState(newState: TelemetryState): Promise<void> {
  state = { ...newState, metrics: [...newState.metrics], providerStates: [...newState.providerStates] }
}
