# CODEBASE CONVENTIONS

## Project file structure

See the fractal-file-structuring skill.

## .ts File structure

The main export and types should always be first, with any consts, types, or other functions defined below.

Prefer small files with one main function export that matches the file name.

## Functions

Prefer function definitions over declaring an arrow function with const.

## Types

Avoid using type casts - always critically inspect the type structure and dependencies instead. If used, type casts must be accompanied by a comment with justification.

Use the `unknown` type when appropriate.

Prefer string union types over just string.

Always use `type` declarations over `interface` (unless explicitly extending another `interface` is unavoidable).

Avoid files defining only types - type definitions should be colocated

## Naming

Use descriptive names for consts and functions, allowing self documenting code. Comments should rarely be needed - the code speaks for itself.

- See #Domain Glossary in CONTEXT.md

## Committing

Before committing, format all changed files with biome:

```
npx biome format [changed files paths] --write
```

The pre-commit hook runs `biome` (check only) and `typecheck`. Running format manually before staging ensures clean commits.

See the scoped-commit-message skill for writing commit messages.


## NO EMOJIS

DO NOT USE EMOJIS EVER.


# Domain Glossary

## Terms

### RoutingMemory

Process-global state learned from past request outcomes that informs future routing decisions. Holds three concerns: circuit breaker, feature discovery, and session affinity. Accessed through a high-level interface so callers never touch the underlying maps directly.

### CircuitBreaker

Tracks which nodes are temporarily out of rotation due to recent failures. Tripped entries expire after a configurable cooldown. Used internally by RoutingMemory.

### FeatureDiscovery

Tracks which features (e.g. `tools`, `response_format`) each node empirically does not support. Accumulated from `unsupported-feature` error responses. Used internally by RoutingMemory.

### SessionAffinity

Policy whereby consecutive requests from the same session stick to the same node. Implemented via SessionRegistry. Used internally by RoutingMemory.

### SessionRegistry

LRU-cache-backed storage that maps session IDs to node keys. Used internally by RoutingMemory to implement SessionAffinity.

### Node

A specific (provider, model) compound representing a single routing target. The atomic unit of scoring, selection, and failover. Represented in code as the `Node` type (`{ providerName: string; modelName: string }`).

### Override

A user-selected pinning of a specific node that takes precedence over automatic routing. Set via the UI header dropdown, and stored in-memory on the server. Cleared on server restart or explicit user action.

### Auto-routing

The default scoring-based weighted-random selection of nodes using telemetry metrics (latency, throughput, reliability). Active when no override is set.

### Override then fallback

Strategy where the overridden node is tried first via a single-node `executeProxyRequest` call. If the pinned node fails (circuit-breaker, upstream error), the system falls through to full auto-routing with all qualified providers.

### Model Priority

User-configured ordered model cascade stored in `~/.hive/model-priority.json`. Defines which models to try and in what order before falling through to full auto-routing. Configurable via the dashboard "priority" button or the REST API at `/api/model-priority`.

### Model Normalization

Transformation of provider-specific model ID variants into canonical names for cross-provider deduplication. Strips org namespace prefixes (`deepseek-ai/deepseek-v4-pro` → `deepseek-v4-pro`), `:free`/`-free` suffixes, soft alias prefixes (`~`), and normalizes case. Implemented in `shared/src/model-normalization.ts`.

### Session

A sequence of related chat-completion requests grouped by a shared identity. Each session contains one or more requests (individual API calls to the upstream provider). Sessions are identified by either a client-supplied header (`x-session-id`, `x-session-affinity`, or `x-parent-session-id`) or a server-computed fingerprint (SHA-256 of the first system message + first user message in the conversation). A session is considered active while any request has a non-terminal path (i.e., its stage path does not end in `complete` or `failed`). A new request with the same identity reactivates a completed session.

Each request tracks a **stage path** — a dynamic sequence of the lifecycle stages it actually passed through (e.g. `["received", "selection", "dispatched", "thinking", "streaming", "complete"]`). There are no gaps; the path reflects the real flow. Stages include: `received`, `selection`, `dispatched`, `thinking`, `streaming`, `tool_use`, `complete`, `failed`.

The Live Sessions UI shows one card per session with three visual states:

- **Default**: Latest request detail (stage path dots, provider:model, prompt, selection round, response) plus compact one-line summaries of previous requests (sequential label, mini dots, provider, status, latency, prompt preview).
- **Full-expanded** (one session at a time): All requests rendered as detailed sub-cards.
- **Sub-request expanded**: Individual previous requests expanded inline.

The prompt preview shown for each request is derived from the **last message** in the conversation at the time of the request (not only user messages), with special handling for tool calls (e.g. `"tool: Read SessionCard.svelte"`) and tool results. Historic (completed) sessions are hidden in a dropdown below active sessions.

### Provider Playground

The dashboard diagnostic surface for sending one prompt through Hive, viewing the streamed response, and intentionally recording telemetry. **Auto** uses normal scoring-based routing without a global Override; selecting a provider/model uses an Exact Diagnostic Route with no fallback. It has no workspace tools and does not participate in Queen Bee Project workflow.

### Exact Diagnostic Route

A Provider Playground request pinned to one selected Node for the duration of that request. Failure is returned directly so the user can tell whether that provider/model works; unlike Override then fallback, it never silently tries another Node.

### ModelCaller

Interface that abstracts upstream model invocation. Used by Workers, the Reviewer, the Requirements Agent, and the Planner to call models through the proxy pipeline. Implemented via `handleChatCompletion`.

### ToolRegistry

Bundles explicit tool definitions and execution logic. Each agent role receives a capability-specific registry. The Worker Agent gets workspace inspection/editing, structured command execution, read-only Git inspection, and `commit_work`; the Reviewer Agent receives read-only inspection only. Requirements Draft mutations use the Requirements Agent's draft tool and never the Worker tool set.

## Queen Bee terms

### Project

A Git repository linked to Hive for requirements planning, card execution, review, and integration. A Project has one Target Branch, one Integration Branch, one Requirements Document, and one Kanban Board.

### Kanban board

A Project's task model. It presents unresolved Ideas separately from Cards, places Cards in five lifecycle Columns, and expresses Card ordering through dependency edges rather than parent-child nesting.

### Authoritative Board Snapshot

The complete persisted Board emitted by the server in a `board_updated` event after a Board mutation. The Board UI applies this snapshot directly; Worker progress is activity, not a client-side source of Card lifecycle state. This prevents stale HTTP reads from overwriting a later server transition.

### Column

A vertical lane on the Kanban Board representing a Card lifecycle stage. The five Columns are Ready, In Progress, Reviewing, Done, and Unfulfillable; Idea is not a Column.

### Idea

A provisional statement of user intent awaiting elaboration and planning. An accepted Planning Proposal resolves and archives the Idea, then creates one or more lineage-linked Cards in Ready.
_Avoid_: Idea Card, provisional Card

### Ideas Backlog

The active collection of unresolved Ideas shown separately from the Kanban Board's Card Columns. Resolved Ideas leave the backlog but remain available through Card lineage and history.
_Avoid_: Idea Column

### Card

A discrete, executable, and reviewable unit of Project work created by an accepted Planning Proposal. A Card has an approved specification, requirement references, dependencies, and a lifecycle beginning in Ready; it should be small enough for one Worker Agent attempt.

### Ready

The Column containing approved Cards eligible for an explicit Run Worker action. A Ready Card has no active Work Attempt.

### In Progress

The Column containing Cards with an active Worker Agent Work Attempt.

### Reviewing

The Column containing Cards whose submitted work passed deterministic completion validation and has an immutable Review Package awaiting or undergoing review and user decision.

### Done

The Column containing Cards whose reviewed Feature Branch was explicitly accepted into the Integration Branch. Done does not imply that the Integration Branch has been integrated into the Target Branch.

### Unfulfillable

The Column containing Cards whose current Work Attempt cannot validly complete and has a structured Handover. Its worktree, Feature Branch, commits, and evidence remain available while the user chooses remediation.

### Card Specification

The approved scope of a Card: title, description, acceptance criteria, relevant files, dependencies, and references into the Requirements Document.

### Requirements Document

The Project-wide source of truth for intended behavior across all Cards. Card changes must remain aligned with it, and new or changed scope revises it rather than becoming an independent source of requirements.
_Avoid_: Card requirements, canonical spec

### Requirements Draft

A provisional replacement for the Requirements Document maintained during a Requirements Session. It is visible live but has no authority until the user confirms it and accepts the resulting Planning Proposal.

### Project Context

A revision-addressed snapshot of relevant repository structure and content independently explored by the Requirements Agent and Planner Agent. It keeps both roles grounded in the same Project revision without sharing either role's conclusions.

### Agent role

A stable AI expertise, authority, toolset, input contract, and output contract. Different session kinds may use the same Agent Role without becoming different agents.

### Agent run

One isolated model context executing an Agent Role. Agent Runs exchange only explicit domain artifacts, never another role's conversation history.

### Requirements Session

A user-facing, multi-turn workflow that uses Requirements Agent Runs to produce a Requirements Draft. Its four kinds are Initial Requirements, Requirements Revision, Idea Elaboration, and Requirements Repair. A Session is active while elicitation continues, complete while its finished draft is still retryable, and submitted/history after a successful Planner handoff. A historical Session never outranks an open Planning outcome or the accepted Board.
_Avoid_: Devise Agent session

### Requirements Agent

The AI role that elicits user intent and maintains a live Requirements Draft. It proposes requirements but does not propose Card Specifications or make requirements authoritative.
_Avoid_: Devise Agent

### Requirements Session Manager

The deterministic system component that owns Requirements Sessions, assembles revision-pinned context, invokes Requirements Agent Runs, and delivers live draft state. It is not an agent.
_Avoid_: Devise engine, Devise Agent, Requirements Supervisor

### Planner Agent

The AI role that independently checks a user-approved Requirements Draft against the canonical requirements, Project Context, Ideas, and Cards. It returns either blocking Requirements Feedback or a complete Planning Proposal, but never edits requirements or makes planning decisions authoritative.

### Planning Manager

The deterministic system component that assembles revision-pinned planning context, invokes Planner Agent Runs, validates and persists their artifacts, and atomically applies an accepted Planning Proposal. It is not an agent.
_Avoid_: Planner, Planner system

### Requirements Feedback

A structured Planner Agent artifact that identifies requirements problems blocking reliable planning. It returns through a fresh Requirements Repair Session without exposing the Planner Agent's conversation or private context.

### Planning Proposal

A provisional, complete reconciliation of a user-approved Requirements Draft, Ideas, and Cards. It contains Idea resolutions, Card Specifications, lineage, dependencies, lifecycle effects, and rationales without making any change authoritative.

### Planning Feedback

Structured user guidance rejecting Card decomposition or planning choices while preserving the Requirements Draft. It starts a fresh Planner Agent Run; disagreement with intended behavior returns through Requirements Repair instead.

### Worker Agent

The AI role that implements one Card inside one isolated Work Attempt. It owns edits and meaningful commits on the Feature Branch, but cannot change the Requirements Document or integrate its work.

### Worker Supervisor (system)

The deterministic system component that manages Work Attempts, applies Worker Admission, validates Worker Agent completion, creates Review Packages, and invokes the Reviewer Agent. It never authors implementation commits and is not an AI role.
_Avoid_: Supervisor Agent, Reviewer

### Worker Admission

The deterministic decision made when the user selects **Run Worker**. Project capacity is a hard blocker. Unmet dependency edges and exact relevant-file overlap with running Cards are soft blockers that require explicit user confirmation. Admission never starts work automatically.

### Project Worker Limit

The maximum number of Worker Agents that may execute concurrently for one Project. It defaults to three, is configurable from the Board, persists in `.hive/project.json`, and is read when admission is evaluated.

### Work Attempt

One execution of a Card by a Worker Agent on a dedicated Feature Branch and worktree. Failed, cancelled, or rejected attempts remain identifiable rather than being silently overwritten.

### Completion Gate

The deterministic boundary between a Worker Agent's completion claim and review. It accepts only committed, clean, requirements-safe work with verification tied to the submitted revision, or a justified no-change result.

### Review Package

An immutable, revision-addressed record of the exact Card specification, requirements, Worker head, reviewed tree, commits, diff, and verification evidence presented for review. Reviewer retries use the same package. When `hive-main` advances cleanly, a refreshed package points at a synthetic Combined Review Commit without changing the Feature Branch.

### Review Readiness

The deterministic comparison between a completed Review Package, the current Feature Branch, its worktree, and current `hive-main`. It reports current, stale, conflicted, branch-changed, dirty, or operational-error state and controls whether acceptance or review refresh is available.

### Review Refresh

Re-evaluation of a stale Review Package against the latest `hive-main`, producing a Combined Review Commit and refreshed package without changing the Feature Branch. Controlled by Review Readiness.

### Review Retry

Re-invocation of the Reviewer Agent on an existing Review Package after a prior error or changes-requested verdict.

### Combined Review Commit

A synthetic merge commit whose parents are the latest `hive-main` revision and the unchanged Worker head. A managed hidden review reference protects it while review retry is valid, and its disposable worktree lets the Reviewer Agent inspect the exact combined state. It is review evidence only and is never merged in place of the Feature Branch.

### Reviewer Agent

The read-only AI role that audits one Review Package and produces an advisory Review Verdict. It cannot edit, run commands, or integrate work.
_Avoid_: Worker Supervisor, Supervisor Agent

### Review Verdict

The Reviewer Agent's structured assessment: approved or changes requested, with findings and a verification assessment. It does not change Project authority by itself.

### Coordinator

The read-only AI role that analyzes an Unfulfillable Card and proposes structured remediation. Its options become Requirements Drafts and Planning Proposals rather than direct mutations.

### Unfulfillable

A Column for Cards that cannot validly proceed under their current specification. The preserved Handover explains the blockage and the Coordinator proposes retry, revision, or archive paths.

### Handover

A structured account of why a Work Attempt cannot proceed, what was tried, and what remains blocking. It is evidence for Coordinator analysis, not a success summary.

### Feature branch

The isolated branch belonging to one Work Attempt. Accepted work may be merged into the Integration Branch; rejected or interrupted work remains available for inspection and revision.

### Integration branch

The local-only Project branch that accumulates accepted work and approved planning snapshots. It is isolated from the user's normal development branch until explicit integration.
_Avoid_: Base branch, main branch

### Target Branch

The user-selected local branch that may explicitly fast-forward to the Integration Branch. Hive never pushes it to a remote, and divergence requires manual reconciliation.

### Acceptance Merge

The explicit user decision that merges approved reviewed work into the Integration Branch. A Card becomes Done only after this merge succeeds.

### Operational state

The local authoritative record of Queen Bee execution state, including Work Attempts, Review Packages, Activity, Planning Proposals, Requirements Feedback, and Requirements Sessions. It is separate from versioned Project specifications.

### Activity

An actor-labelled timeline of significant Project workflow events. It summarizes Supervisor, Worker, Reviewer, Requirements, Planner, and user actions while retaining expandable diagnostic detail.

### PR (Pull Request)

A possible future remote publication of accepted local work. It is not part of the current Queen Bee authority or review flow.
