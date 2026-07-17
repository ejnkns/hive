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

> **Work in progress.** This project is under active development.

Automatically route OpenAI-compatible agent traffic to free model providers.

A lightweight proxy daemon with agent routing and automatic failover, hiding the volatility of free model providers by continuously monitoring quality and swapping providers and models automatically.

### Dynamic Model Routing

- Discards the client's model field; routes to the best scoring `provider:model` based on real-time telemetry (TTFT, throughput, error rate)
- Session affinity: consecutive requests from the same session stick to the same `provider:model` node, unless a better-scoring one exists
- Circuit breaker: failing providers returning `429`/`503`/`401` are temporarily taken out of rotation
- Feature discovery: learns which `provider:model` nodes don't support features like `tools` or `response_format`, stops sending incompatible requests
- Failover: on failure, transparently retries the next best `provider:model` node

### Telemetry

- Metrics recorded in-memory, persisted to `~/.hive/telemetry-cache.json`
- Scoring uses a 100-entry, 24h window per node with exponential TTFT decay and severity-weighted error penalties (auth 2.5x, server 1.0x, rate-limit 0.5x)
- Providers recover score gradually as successful requests accumulate (30min half-life decay)
- Truncated streams (missing `[DONE]` / `finish_reason`) are counted as failures, not successes

### Orchestrator

An agentic tool-calling loop that runs server-side, routing each iteration through the same provider selection pipeline. Built-in tools include file read/write and command execution, with automatic failover across providers. Results stream live to a collapsible UI panel.

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

| Variable               | Target Provider  | Base URL Endpoint                                         |
| ---------------------- | ---------------- | --------------------------------------------------------- |
| `GROQ_API_KEY`         | Groq             | `https://api.groq.com/openai`                             |
| `SAMBA_NOVA_API_KEY`   | SambaNova        | `https://api.sambanova.ai`                                |
| `SCALEWAY_API_KEY`     | Scaleway         | `https://api.scaleway.ai`                                 |
| `GOOGLE_API_KEY`       | Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `NVIDIA_NIM_API_KEY`   | NVIDIA NIM       | `https://integrate.api.nvidia.com`                        |
| `GITHUB_TOKEN`         | GitHub Models    | `https://models.github.ai/inference`                      |
| `CEREBRAS_API_KEY`     | Cerebras         | `https://api.cerebras.ai`                                 |
| `DEEPSEEK_API_KEY`     | DeepSeek         | `https://api.deepseek.com`                                |
| `MISTRAL_API_KEY`      | Mistral          | `https://api.mistral.ai`                                  |
| `OPENROUTER_API_KEY`   | OpenRouter       | `https://openrouter.ai/api/v1`                            |
| `OVH_AI_ENDPOINTS_ACCESS_TOKEN` | OVHcloud AI | `https://oai.endpoints.kepler.ai.cloud.ovh.net`       |
| `OPENCODE_ZEN_API_KEY` | OpenCode Zen     | `https://opencode.ai/zen`                                 |
| `OLLAMA_API_KEY`\*     | Ollama           | `http://127.0.0.1:11434/v1` or `OLLAMA_HOST` in `.env`    |
| `OMLX_API_KEY`\*       | oMLX             | `http://127.0.0.1:8000/v1` or `OMLX_HOST` in `.env`       |
| `LM_STUDIO_API_KEY`\*  | LM Studio        | `http://127.0.0.1:1234/v1` or `OMLX_HOST` in `.env`       |

\* not required unless configured in the provider.

### Model Discovery

On startup, [ **h i v e** ] fetches the live model list from each provider's `/models` endpoint and caches it to `~/.hive/models-cache.json`. A preference list per provider prioritises models - the first available preferred model becomes the default. Falls back to a hardcoded default if no preferred model is found.

---
