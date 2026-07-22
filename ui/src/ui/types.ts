import type {
  AvailableProvider,
  CandidateInfo,
  ContentPart,
  ConversationData,
  ConversationMessage,
  FlowEvent,
  MetricData,
  OverrideState,
  RequestState,
  SessionPatch,
  SessionStage,
  SessionState,
  StatsData,
  SubScores,
  ToolCall,
} from "shared/dashboard-types";

export type {
  AvailableProvider,
  CandidateInfo,
  ContentPart,
  ConversationData,
  ConversationMessage,
  FlowEvent,
  MetricData,
  OverrideState,
  RequestState,
  SessionPatch,
  SessionStage,
  SessionState,
  StatsData,
  SubScores,
  ToolCall,
};

export type ProviderData = {
  name: string;
  displayName: string;
  model: string;
  keyConfigured: boolean;
  stabilityScore: number;
  subscores: SubScores;
  p95Latency: number | null;
  meanTokensPerSecond: number | null;
  requestCount: number;
  recentSuccessRate: number;
  truncationRate: number;
  refusalRate: number;
  contentFilterRate: number;
  trippedUntil: number | null;
  disabledFeatures: string[] | null;
  disabled: boolean;
};

export type HeaderData = {
  online: boolean;
  serverAddr: string;
  lastProvider: string | null;
  lastModel: string | null;
  override: OverrideState;
  availableProviders: AvailableProvider[];
  bestProvider: string | null;
  bestModel: string | null;
  bestScore: number | null;
  routingStrategy: string;
  contextWindowWeight: number;
  traffic: number;
  successRate: number | null;
  activeProviders: number;
  avgLatency: number | null;
};
