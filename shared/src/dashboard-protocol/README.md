# Dashboard WebSocket Protocol

The dashboard WebSocket protocol provides a single typed stream of server-computed state. A thin consumer opens one WebSocket, receives self-contained messages, and renders with zero local state reconciliation.

## Lifecycle

### 1. Connect

Open a WebSocket to `/ws`. No handshake required.

### 2. Hydration

On connect the server sends a single `init` message containing the full current state:

- `providers` — all configured provider:model pairs with stability scores
- `availableProviders` — flat list of provider names and models for dropdowns
- `metrics` — completed request records (latency, status, scores; no conversation content)
- `override` — current pinned provider:model (if any)
- `sessions` — active and completed session trees pre-sorted by the server
- `logs` — recent buffered log entries
- `stats` — derived dashboard statistics (traffic, success rate, latency, etc.)
- `modelPriorityConfig` — the model-priority configuration (if any)
- `serverHost`, `serverPort`, `routingStrategy`, `contextWindowWeight`, `pending`

### 3. Updates

After hydration the consumer receives targeted update messages. Each message carries its own complete payload — the consumer replaces its local data directly:

| Message | State replaced |
|---|---|
| `session_snapshot` | `sessions` |
| `provider_update` | `providers` |
| `metrics_update` | `metrics` |
| `stats_update` | `stats` |
| `override_update` | `override` |
| `available_providers_update` | `availableProviders` |
| `model_priority_update` | model priority config |
| `pipeline_state` | Append to pipeline event list |
| `log` | Append to log entries |

### 4. Commands

The client may send three command types:

- `override` — pin or unpin a provider:model
- `toggle_provider` — enable or disable a provider
- `update_model_priority` — save a new model-priority configuration

## Conversation data

Conversation content (prompt and response text) is delivered **only** on the session tree: `session_snapshot` requests carry `conversationPrompt`/`responseText`. It is not embedded on `MetricData` and there is no separate `session_detail` command or `/api/conversations` endpoint — the session tree is the single channel.

## Message Semantics

### `session_snapshot`

Fires on every session state change: new request received, stage advanced, request completed, or request failed. The snapshot carries `active` and `completed` arrays pre-sorted by `lastActivity` descending. Active sessions are those with at least one request whose final stage is not `complete` or `failed`. Completed requests within each session carry their conversation (`conversationPrompt`/`responseText`).

### `pipeline_state`

Fires once per proxy pipeline phase transition. Each event is self-contained — it carries `sessionId`, `stage`, `provider`, and `model` so the consumer renders pipeline traffic without tracking state across events. No buffering or replay; the pipeline visualization starts blank on connect and fills as new requests arrive.

### `provider_update`

Fires when provider scoring changes (typically after a request completes). The server sorts providers by `stabilityScore` descending. Consumers replace their local provider array directly.

### `metrics_update`

Fires when a new request completes. The array carries the full metrics history (latency, status, scores). Consumers replace their local metrics array directly.

### `stats_update`

Fires when any statistic-affecting change occurs. All stats are server-computed — the consumer renders the values with zero derivation logic.

## Type Contract

All message types are defined in `shared/src/dashboard-types.ts`. Import `WsServerMessage` and `WsClientMessage` for the full discriminated unions.
