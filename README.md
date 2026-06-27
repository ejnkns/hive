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

A lightweight OpenAI-compatible proxy daemon with LLM routing and automatic failover, hiding the volatility of free LLM endpoints by continuously monitoring quality and swapping providers and models automatically, according to your preferences.

```
[Coding CLI (OpenCode, Claude, Gemini, etc.)]
     │
     v
[hive:Proxy]
     │
     ├──> Parses incoming payload
     │
     ├──> Mutate headers (inject model provider API keys)
     │
     v
[hive:Node Selector] ──> Score & select best provider:model
     │
     v
[hive:Upstream Stream] ──> Stream OK? ───(Yes)──> Pipe back to client
     │                       │
     │                     (No)
     │                       │
     │                       v
     │              Normalize error
     │                       │
     │              ┌────────┴────────┐
     │              v                 v
     │    unsupported-feature    rate-limit / 5xx / auth
     │         │                      │
     │    mark disabled           trip circuit breaker
     │         │                      │
     v         v                      v
[hive:Failover] ────> retry next node (max 3 attempts)
```

### Dynamic Model Routing

- Discards the client's model field; routes to the best-scoring provider:model based on real-time telemetry (TTFT, throughput, error rate)
- Session affinity: consecutive requests from the same session stick to the same `provider:model` node, unless a better-scoring one exists
- Circuit breaker: failing providers returning `429`/`503`/`401` are temporarily taken out of rotation
- Feature discovery: learns which `provider:model` nodes don't support features like `tools` or `response_format`, stops sending incompatible requests
- Failover: on failure, transparently retries the next best `provider:model` node

### Telemetry

- Metrics recorded in-memory, persisted to `~/.hive/telemetry-cache.json`
- Scoring uses a 100-entry, 24h window per node with exponential TTFT decay and severity-weighted error penalties (auth 2.5x, server 1.0x, rate-limit 0.5x)
- Providers recover score gradually as successful requests accumulate (30min half-life decay)
- Truncated streams (missing `[DONE]` / `finish_reason`) are counted as failures, not successes

### Browser Dashboard

A lightweight Web Components dashboard is served at `http://localhost:5173` showing live provider states, stability scores, activity metrics, and transient conversation history.

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

| Variable               | Target Provider  | Base URL Endpoint                                         | Baseline Fallback Model         |
| ---------------------- | ---------------- | --------------------------------------------------------- | ------------------------------- |
| `GROQ_API_KEY`         | Groq             | `https://api.groq.com/openai`                             | `deepseek-r1-distill-llama-70b` |
| `SAMBA_NOVA_API_KEY`   | SambaNova        | `https://api.sambanova.ai`                                | `DeepSeek-R1`                   |
| `GOOGLE_API_KEY`       | Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash-exp`          |
| `NVIDIA_NIM_API_KEY`   | NVIDIA NIM       | `https://integrate.api.nvidia.com`                        | `meta/llama-3.3-70b-instruct`   |
| `GITHUB_TOKEN`         | GitHub Models    | `https://models.github.ai/inference`                      | `gpt-4o`                        |
| `CEREBRAS_API_KEY`     | Cerebras         | `https://api.cerebras.ai`                                 | `llama-3.3-70b`                 |
| `MISTRAL_API_KEY`      | Mistral          | `https://api.mistral.ai`                                  | `codestral-latest`              |
| `OPENCODE_ZEN_API_KEY` | OpenCode Zen     | `https://opencode.ai/zen`                                 | `gpt-5.5`                       |

### Model Discovery

On startup, [ **h i v e** ] fetches the live model list from each provider's `/models` endpoint and caches it to `~/.hive/models-cache.json`. A preference list per provider prioritises models - the first available preferred model becomes the default. Falls back to a hardcoded default if no preferred model is found.

---
