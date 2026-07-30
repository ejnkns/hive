# Queen Bee architecture

> **Note: Pre-workflow-engine reference.** This document describes the legacy
> component architecture (Worker Supervisor, Requirements Session Manager,
> Planning Manager). These roles have been replaced by the workflow engine's
> state-machine model — see root-level [`ARCHITECTURE.md`](../ARCHITECTURE.md)
> and [`CONTEXT.md`](../CONTEXT.md) for the current architecture.

## Status

Phases 1-9 are implemented on the `queen-bee` branch. This document describes the implemented local-only architecture, not the superseded pre-Phase-6 design.

## Overview

```text
Hive Server
├── Proxy layer                 provider selection, failover, telemetry
├── Provider Playground         direct auto or exact-route diagnostics
├── Queen Bee
│   ├── Project store          local Hive project metadata and registry
│   ├── Specification store   approved requirements and Card specifications on hive-main
│   ├── Requirements Session Manager  persisted requirements conversations and drafts
│   ├── Planning Manager       invokes Planner Agent reconciliation
│   ├── Worker Supervisor      deterministic work-attempt lifecycle
│   ├── Worker Agent           edits and commits in an isolated worktree
│   ├── Reviewer Agent         read-only audit of an immutable Review Package
│   ├── Coordinator            read-only remediation analysis
│   ├── Integration manager    local hive-main and target-branch operations
│   └── Runtime store          execution state under ~/.hive
├── Queen Bee API              REST commands and one WebSocket event stream
└── Svelte UI                  board, live drafts, activity, review decisions
```

The proxy remains a routing layer. Queen Bee owns project workflow above it and streams agent activity directly to the UI.

The dashboard Provider Playground also uses the proxy but remains outside Queen Bee workflow. Auto diagnostics use normal weighted routing without applying the global Override. Exact diagnostics address one provider/model and return its failure directly instead of falling back, which makes the result useful for manual capability checks while still generating normal telemetry.

## Authority boundaries

| Actor | Reads | Writes | Commits | Decides authority |
|---|---|---|---|---|
| Requirements Agent | Requirements and Project Context | Requirements Draft only | No | No |
| Planner Agent | Draft, board, Project Context | Planning Proposal only | No | No |
| Worker Agent | Card, requirements, worktree | Assigned worktree | Yes, through `commit_work` | No |
| Worker Supervisor | Work attempt and Git evidence | Operational state | Never | Deterministic validation only |
| Reviewer Agent | Immutable Review Package | Structured verdict only | Never | Advisory only |
| Coordinator | Handover and requirements | Structured suggestions only | Never | Advisory only |
| User | Proposals, reviews, integration status | Explicit decisions | Indirectly through system actions | Yes |

The terms **Worker Supervisor** and **Reviewer Agent** are deliberately distinct. The former is deterministic system code; the latter is a read-only model role.

## Versioned project state

Approved planning artifacts are stored in the linked repository and committed on `hive-main`. Hive writes them through a managed integration worktree; it does not materialize them in the checked-out Target Branch before explicit integration:

```text
<repo>/.hive/
├── requirements.md    Project-wide approved Requirements Document
├── board.json         approved board structure and card specifications
└── cards/
    └── <card-id>.json approved per-card specification
```

Runtime fields are stripped before these files are saved. The Integration Branch is the authority for approved requirements and card definitions.

## Operational state

Execution data and provisional planning state live outside linked repositories:

```text
~/.hive/
├── projects.json
├── requirements-sessions/<project-id>/
├── project-context/<project-id>/
└── queen-bee/projects/<project-id>/
    ├── card-state/
    ├── ideas.json
    ├── activity/
    ├── review-packages/
    ├── planning-proposals/
    └── requirements-feedback/
```

Writes are atomic. Review Packages are immutable by ID. This state is authoritative for execution history but is never committed to a user's project. Synthetic Combined Review Commits are protected from Git garbage collection by managed `refs/hive/reviews/*` references only while a review decision or retry remains valid; those refs are evidence anchors, not Project authority.

## Planning flow

1. A Requirements Session invokes the Requirements Agent, which interviews the user and updates a persisted Requirements Draft with `update_requirements_draft`.
2. Every draft update is streamed to the UI immediately.
3. Explicit confirmation sends the draft to the Planner Agent; it does not write canonical requirements directly.
4. The Planner Agent reconciles every existing Card with keep, create, update, or remove decisions.
5. Active and Done Cards are immutable. Required changes become follow-up work.
6. The user accepts changes individually or accepts all. Rejected changes block application.
7. Applying a complete accepted proposal atomically commits the Requirements Document and Card Specifications on `hive-main` through the Specification Store, without dirtying the Target Branch.
8. Stale requirements or board revisions reject the proposal instead of overwriting newer state.

Initial Requirements, project-wide **Revise**, Idea Elaboration, per-card refinement, Requirements Repair, Coordinator retry, and Coordinator archive all use this same draft-and-reconcile boundary.

## Worker and review flow

1. **Run Worker** evaluates Project-scoped capacity, dependency, and relevant-file admission, then creates `hive/<card-id>/attempt-<n>` from `hive-main` in an isolated worktree.
2. The Worker Agent edits only that worktree. Its command tool accepts an executable plus an argument array; direct mutating Git commands are rejected.
3. The Worker Agent makes coherent commits through `commit_work`, allowing project hooks and commit conventions to run.
4. It finishes with `submit_work`, providing outcome and verification evidence instead of a free-form success summary.
5. The Completion Gate requires a clean worktree, commits ahead of the recorded base or a valid no-change claim, protected requirements, and verification tied to submitted HEAD.
6. Invalid completion receives deterministic reprompts. Repeated invalid completion becomes Unfulfillable while preserving the branch and worktree.
7. The Worker Supervisor builds and persists an immutable Review Package.
8. The Reviewer Agent audits that package with read-only tools and returns a structured verdict. If `hive-main` advanced cleanly, Hive creates a new package and disposable worktree from a Combined Review Commit so inspection uses the exact integrated-plus-Worker tree.
9. Approval keeps the Card in Reviewing until the user explicitly accepts it. Changes requested require explicit guidance or a review restart.
10. Acceptance performs a no-fast-forward merge into `hive-main`; only then does the Card become Done and eligible for cleanup.

Legacy `qb/*` branches are recovered without rewriting or deleting unrelated history.

## Integration flow

Each Project records the Target Branch selected when it is linked. Queen Bee maintains the local-only `hive-main` Integration Branch without switching the user's checkout.

The UI reports whether the Target Branch is:

- **integrated**: already contains `hive-main`;
- **ready**: can fast-forward to `hive-main`; or
- **diverged**: requires manual reconciliation.

The user must explicitly request Target Branch integration. Queen Bee refuses user-dirty or diverged targets and never pushes a remote. Before integration, the Target Branch remains clean because approved `.hive/` files exist only on `hive-main`.

## Unfulfillable flow

1. The Worker Agent or Completion Gate records a structured Handover.
2. The Card moves to Unfulfillable with its worktree preserved.
3. The Coordinator analyzes the Handover against the current Requirements Document.
4. It proposes `retry_with_patch`, `redevise`, or `archive`, each with rationale.
5. Every requirements-affecting option starts or supplies a Requirements Draft and then a Planning Proposal.
6. The user explicitly accepts the reconciled requirements and Card changes before the Card returns to Ready or is archived.

## Live events

`/api/queen-bee/ws` is the single Queen Bee WebSocket endpoint. It carries complete authoritative Board Snapshots, Worker progress, actor-labelled activity, Requirements Session conversation updates, and live Requirements Draft changes.

After every Board mutation, the server reads the persisted Board and sends it in `board_updated`. The Board UI applies that snapshot directly and ignores Worker progress for lifecycle reloads; HTTP Board reads are for initial load and fallback only, and stale outstanding reads are discarded. This keeps lifecycle authority on the server and prevents an older In Progress response from overwriting a later Reviewing state. Other consumers, such as Target Branch integration status, may refresh their own derived data on the Board event.

The development UI remains on port `8153`. The less-visible Fastify development backend uses `8154`, preventing the Vite WebSocket proxy from recursively targeting itself. Production serves the built UI and server together.

## Current boundaries

- Local repositories and branches only; no push, pull request, or CI integration.
- Explicit tools and command validation are best-effort controls, not a security sandbox.
- Reviewer inspection is read-only and does not execute verification commands.
- Parallel admission, configurable Project capacity, and readiness/conflict UX are implemented. Automatic queues, semantic conflict prediction, and conflict resolution remain future work.
- The legacy workspace-writing dashboard Orchestrator has been removed. The Provider Playground is diagnostic-only and cannot read or mutate project workspaces.
