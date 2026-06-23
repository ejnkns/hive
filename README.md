 <mark style="color:black;white-space:pre-wrap;font-family:monospace;background:#708097;line-height:0.7">
                             <span style="color:yellow"><b>h i v e</b></span> 
    ,-. <span style="color:white">     .' '.        .`         </span>
    \_/ <span style="color:white">     .   .       .           </span>
 <span style="color:yellow"><b>:</span>>(<span style="color:yellow">|</span>|<span style="color:yellow">|</span>}</b><span style="color:white">.      .        .            </span>
    / \  <span style="color:white">'. . ' ' . . '              </span>
    `-'                              
</mark>

---

[ **h i v e** ]

_The queen provides,_

_not all bees thrive,_

_sting and they die,_

_replaced with the alive._

A lightweight OpenAI-compatible proxy daemon that provides <!--seamless--> LLM routing and automatic failover, masking the volatility of free LLM endpoints by <!--instantly--> replacing dead providers with active ones<!-- behind the scenes-->.

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
[hive:Prioritised Model] ──> Stream Working?───(Yes)──> Pipe back to client
     │                  ^                  │
     │                  │                  v
     │         Next priority model <──────(No)
     │                  ^
     v                  │
[hive:Failover] ────────┘
```

### Dynamic Model Routing Loop

Hive intercepts incoming requests and discards the model field. It dynamically routes the stream to the prioritised provider model, based on a **stability score** (WIP).

If the first model provider fails to reply, times out, or returns an HTTP error code (e.g. `429`, `500`), the proxy intercepts the failure before returning it to the agent client, automatically rewrites the payload headers with the next model provider's API key, and routes the request to that provider's designated `defaultModel`.

## Client Integration

### OpenCode

Add the custom Hive proxy in your local (`./opencode.json`) or global (`~/.config/opencode/opencode.json`) file:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "hive": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "hive",
      "options": {
        "baseURL": "http://127.0.0.1:19280/v1",
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

- **Authorisation Key:** `any-arbitrary-string` (authenticators bypass this as local validation, relying on server-side configurations)
- **Base Endpoint:** `http://127.0.0.1:19280`

---

## Model Providers Config

Configuration is loaded synchronously from `.env` or from exported system variables during initialisation:

| Variable               | Target Provider  | Base URL Endpoint                                         | Baseline Fallback Model         |
| ---------------------- | ---------------- | --------------------------------------------------------- | ------------------------------- |
| `GROQ_API_KEY`         | Groq             | `https://api.groq.com/openai`                             | `deepseek-r1-distill-llama-70b` |
| `SAMBA_NOVA_API_KEY`   | SambaNova        | `https://api.sambanova.ai/v1`                             | `DeepSeek-R1`                   |
| `GOOGLE_API_KEY`       | Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash-exp`          |
| `NVIDIA_NIM_API_KEY`   | NVIDIA NIM       | `https://integrate.api.nvidia.com`                        | `meta/llama-3.3-70b-instruct`   |
| `GITHUB_TOKEN`         | GitHub Models    | `https://models.inference.ai.azure.com`                   | `gpt-4o`                        |
| `CEREBRAS_API_KEY`     | Cerebras         | `https://api.cerebras.ai/v1`                              | `llama-3.3-70b`                 |
| `MISTRAL_API_KEY`      | Mistral          | `https://api.mistral.ai/v1`                               | `codestral-latest`              |
| `OPENCODE_ZEN_API_KEY` | OpenCode Zen     | `https://opencode.ai/zen`                                 | `gpt-5.5`                       |

---
