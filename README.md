 <pre style="color:black;white-space:pre-wrap;font-family:monospace;background:#708097;line-height:0.8;letter-spacing:-4px;font-size:2em">
                             <span style="color:yellow">[ <b>h i v e</b> ]</span> 
    ,-. <span style="color:white">     .' '.        .`         </span>
    \_/ <span style="color:white">     .   .       .           </span>
 <span style="color:yellow"><b>:</span>>(<span style="color:yellow">|</span>|<span style="color:yellow">|</span>}</b><span style="color:white">.      .        .            </span>
    / \  <span style="color:white">'. . ' ' . . '              </span>
    `-'                              
</pre>

---

[ **h i v e** ]

<!--
_The queen provides,_

_not all bees thrive,_

_sting and they die,_

_replaced with the alive._
-->

> **Work in progress.**

Hive is a local LLM proxy daemon with telemetry-driven model routing, plus a
declarative flow engine that runs AI agents server-side. It hides the
volatility of free model providers by continuously monitoring quality and
swapping providers automatically.

New here? Read the tutorial in `docs/tutorial/` — a step-by-step walkthrough
of how the codebase works, pointing at the exact files:
[01-what-is-hive.md](docs/tutorial/01-what-is-hive.md) starts with the package
map and boot sequence.

## What Hive does

- **Smart LLM proxy** — point any OpenAI-compatible client at
  `http://127.0.0.1:8153/v1`; Hive forwards each request to the best-scoring
  `provider:model` node and streams the reply back.
- **Flow engine** — declarative workflows (states, edges, gates, tasks) whose
  tasks can be deterministic operations or agentic AI loops. Presets built on
  it: **queen-bee** (AI project management with a Kanban board, worker and
  reviewer agents), **honeycomb** (self-organizing content), **wayfinder**
  (research/collection flows).

The README's design mantra: *flows = product, proxy = backbone* (see
`docs/design-plan.md`). Repo layout: `server/` (the daemon), `ui/` (Svelte
dashboard), `workflow-engine/`, `telemetry/`, `shared/`, `presets/`, `e2e/`.

### Dynamic Model Routing

- Discards the client's model field; routes to the best scoring `provider:model` based on real-time telemetry (TTFT, throughput, error rate)
- Session affinity: consecutive requests from the same session stick to the same `provider:model` node, unless a better-scoring one exists
- Circuit breaker: failing providers returning `429`/`503`/`401` are temporarily taken out of rotation
- Feature discovery: learns which `provider:model` nodes don't support features like `tools` or `response_format`, stops sending incompatible requests
- Failover: on failure, transparently retries the next best `provider:model` node
- Manual override: pin a `provider:model` from the dashboard header; the pinned node is tried first, falling through to auto-routing on failure
- Model priority cascade: a user-configured ordered list of models tried before full auto-routing (`~/.hive/model-priority.json`)

### Telemetry

- Metrics recorded in-memory, persisted to `~/.hive/telemetry-cache.json`
- Scoring uses a 100-entry, 24h window per node with exponential TTFT decay and severity-weighted error penalties (auth 2.5x, server 1.0x, rate-limit 0.5x)
- Providers recover score gradually as successful requests accumulate (30min half-life decay)
- Truncated streams (missing `[DONE]` / `finish_reason`) are counted as failures, not successes
- Score composition is a weighted additive sum — `HIVE_ROUTING_STRATEGY` selects the weights (`balanced` default, `latency`, `quality`); `HIVE_CONTEXT_WINDOW_WEIGHT` (0–1, default 0) blends in a context-window bonus; `HIVE_MIN_TOKEN_TELEMETRY` (default 200) skips short prompts when benchmarking
- Quality scoring tracks tool-call success, refusals, content-filter rate, and finish reasons

### Flows

A flow definition is pure data — workflows, states, tasks, gates, edges — that
the engine (`workflow-engine/`) compiles into a runtime. AI tasks call models
**through the same routing pipeline** as external clients, with a standard tool
registry (file read/write, command execution, git, web fetch). The server
registers, persists, serves, and can even **AI-author** definitions
(`POST /api/flows/definitions/author` — an agentic session that writes the
definition module and validates it against a typechecking gate).

- Queen Bee: a project management flow — Ideas backlog, Kanban board (Ready →
  In Progress → Reviewing → Done / Unfulfillable), worker agents that implement
  cards in isolated git worktrees, reviewer agents, and a requirements document
- Honeycomb: self-organizing content system
- Wayfinder: research flows
- Flows persist to `~/.hive/flows/` and survive restarts (runtime rehydration at boot)

### Browser Dashboard

A Svelte dashboard (with Lit web components for flow rendering) served at
`http://127.0.0.1:8153` showing live provider states, stability scores,
activity metrics, and transient conversation history — live via WebSocket.

- Session identity: `x-session-id` / `x-session-affinity` / `x-parent-session-id` headers, falling back to a SHA-256 fingerprint of the system + first user message
- Live pipeline visualization and three-state session cards (latest request / full-expanded / sub-request expanded)
- Flow library, flow editor with an AI authoring chat, and the generic flow canvas/board

### API

- `/api-spec` — interactive API reference (`static/api-spec.html`)
- `/api-spec.yaml` — raw OpenAPI spec
- `/v1/chat/completions` — the OpenAI-compatible proxy endpoint
- `/api/flows*` — flow REST API; `/api/flows/ws` — flow realtime WebSocket

## Client Integration

### OpenCode

Add the custom [ **h i v e** ] proxy in your local (`./opencode.json`) or global (`~/.config/opencode/opencode.json`) file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "hive": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "hive",
      "options": {
        "baseURL": "http://127.0.0.1:8153/v1",
        "apiKey": "{env:HIVE_API_KEY}"
      },
      "models": {
        "default": { "name": "bee" }
      }
    }
  },
  "model": "hive/bee"
}
```

### General CLI Authentication

Set custom base configurations inside clients supporting OpenAI integrations:

- **Authorisation Key:** Any arbitrary string. Authentication is handled server-side by the provider API keys in your `.env` file.
- **Base Endpoint:** `http://127.0.0.1:8153`

---

## Model Providers Config

Configuration is loaded synchronously from `.env` or from exported system variables during initialisation:

| Variable               | Target Provider  | Base URL Endpoint                                         |
| ---------------------- | ---------------- | --------------------------------------------------------- |
| `GROQ_API_KEY`         | Groq             | `https://api.groq.com/openai`                             |
| `ROUTEWAY_API_KEY`     | Routeway         | `https://api.routeway.ai`                                 |
| `SAMBA_NOVA_API_KEY`   | SambaNova        | `https://api.sambanova.ai`                                |
| `SCALEWAY_API_KEY`     | Scaleway         | `https://api.scaleway.ai`                                 |
| `GOOGLE_API_KEY`       | Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `NOVITA_API_KEY`       | Novita AI        | `https://api.novita.ai/openai`                            |
| `NVIDIA_NIM_API_KEY`   | NVIDIA NIM       | `https://integrate.api.nvidia.com`                        |
| `GITHUB_TOKEN`         | GitHub Models    | `https://models.github.ai/inference`                      |
| `CEREBRAS_API_KEY`     | Cerebras         | `https://api.cerebras.ai`                                 |
| `DEEPSEEK_API_KEY`     | DeepSeek         | `https://api.deepseek.com`                                |
| `MISTRAL_API_KEY`      | Mistral          | `https://api.mistral.ai`                                  |
| `OLLAMA_CLOUD_API_KEY` | Ollama Cloud     | `https://ollama.com`                                      |
| `OPENROUTER_API_KEY`   | OpenRouter       | `https://openrouter.ai/api/v1`                            |
| `OVH_AI_ENDPOINTS_ACCESS_TOKEN` | OVHcloud AI | `https://oai.endpoints.kepler.ai.cloud.ovh.net`       |
| `OPENCODE_ZEN_API_KEY` | OpenCode Zen     | `https://opencode.ai/zen`                                 |
| `OLLAMA_API_KEY`\*     | Ollama           | `http://127.0.0.1:11434/v1` or `OLLAMA_HOST` in `.env`    |
| `OMLX_API_KEY`\*       | oMLX             | `http://127.0.0.1:8000/v1` or `OMLX_HOST` in `.env`       |
| `LM_STUDIO_API_KEY`\*  | LM Studio        | `http://127.0.0.1:1234/v1` or `LM_STUDIO_HOST` in `.env`    |

\* not required unless configured in the provider.

### Model Discovery

On startup, [ **h i v e** ] fetches the live model list from each provider's `/models` endpoint and caches it to `~/.hive/models-cache.json`. A preference list per provider prioritises models - the first available preferred model becomes the default. Falls back to a hardcoded default if no preferred model is found.

## Development

```bash
pnpm install
pnpm dev            # server (watch, port 8154) + UI (Vite, port 8153, proxying /api and /ws to the server)
pnpm build          # telemetry → ui → server (bundled binary at server/dist/main.mjs)
pnpm test           # unit + e2e suite
```

See `docs/tutorial/08-tests-and-tooling.md` for the test layout, and
`CONTEXT.md` for code conventions (fractal file structure, `.ts`-suffixed
relative imports, no emojis).
