// === QUEEN BEE DOMAIN MEANING ===
//
// The shared types that give queen-bee its domain vocabulary. There is no file
// persistence here: authoritative state is task outputs persisted by the engine
// (persist + commit_flow_state), workflow instance state, or derived views.

export type CardSpec = {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
};

// A card proposed by the planning agent. Dependencies reference other card
// titles; the engine's dependsOnState gates reference card instance ids, so
// the queen-bee flow keeps them as titles at plan time and the worker
// admission wiring resolves them against the created cards.
export type PlanCard = {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependencies: string[];
};

export type PlanProposal =
  | { kind: "proposal"; cards: PlanCard[] }
  | { kind: "feedback"; guidance: string };

export type ReviewPackage = {
  packageId: string;
  cardId: string;
  attempt: number;
  spec: CardSpec;
  requirements: string;
  baseCommit: string;
  workerHead: string;
  diff: string;
  createdAt: string;
};
