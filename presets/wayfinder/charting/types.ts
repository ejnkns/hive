// The charting workflow's instance state type, self-contained for the
// referenced charting ops (they cannot import types from the rendered entry).

export type ChartingState = {
  // Written by the submit_map recording tool during the naming session; read
  // by settle_chart to build the persisted map (with creation-time config as
  // the fallback).
  destination?: string;
  notes?: string;
};
