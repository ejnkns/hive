# Adding a Provider

The type is defined in [`registry.ts`](./registry.ts) — `<Provider>` is the single source of truth.

## Reference

### Provider shape

Each provider is a module in `registry/` exporting an object that `satisfies Provider` from `../registry`. Shape:

- **`name`** — machine-readable key, lowercase with hyphens (`"google-ai"`, `"deepseek"`). Must be unique.
- **`displayName`** — human-readable label shown in the UI (`"Google AI"`, `"DeepSeek"`).
- **`baseUrl`** — API base URL without a trailing slash (`"https://api.deepseek.com"`). Trailing slashes are stripped during registration.
- **`apiKeyEnvVar`** — environment variable name holding the API key (`"DEEPSEEK_API_KEY"`). A provider is only qualified at runtime if this var is set and non-empty.
- **`models`** — `ModelEntry[]`, where each entry is either a plain model ID string or `{ id: string; contextLength?: number }`.
- **`defaultModel`** — the model used by the proxy when no override is pinned. Must be one of the IDs in `models`.
- **`modelPreferences`** — ordered list of model IDs, used by model discovery to select the best available model when a `/v1/models` response arrives. The first match wins. Falls back to `defaultModel` if none match.

### Endpoints

The proxy constructs chat and model-list endpoints from `baseUrl`:

- If `baseUrl` already contains `/v\d` (e.g. `/v1beta`), the suffix is appended directly (`/chat/completions`, `/models`).
- Otherwise `/v1/` is inserted (`/v1/chat/completions`, `/v1/models`).

### Files involved

| File | Role |
|---|---|
| `server/src/server/providers/registry/<name>.ts` | Provider definition |
| `server/src/server/providers/registry.ts` | Imports and registers in `allProviders` |
| `example.env` | Documents the required API key env var |
| `README.md` | Table of providers under "Model Providers Config" |

## Steps

### 1. Create the provider file

Create `server/src/server/providers/registry/<name>.ts`. Match the pattern from any existing provider (e.g. `deepseek.ts`):

```ts
import type { Provider } from "../registry";

export const <name> = {
  name: "<name>",
  displayName: "<DisplayName>",
  baseUrl: "<baseUrl>",
  apiKeyEnvVar: "<NAME>_API_KEY",
  models: [
    { id: "<model-id>", contextLength: <number> },
  ],
  defaultModel: "<model-id>",
  modelPreferences: ["<model-id>", ...],
} satisfies Provider;
```

Use `_` separators in large context lengths (`1_000_000` not `1000000`).

**Completion criterion:** The file exists, imports `Provider`, exports a const that `satisfies Provider`, and every field is populated with real values.

### 2. Register in the provider barrel

In `server/src/server/providers/registry.ts`:

- Add an import: `import { <name> } from "./registry/<name>";`
- Add the provider to the `allProviders` array.

Keep imports sorted alphabetically. Keep `allProviders` order matching import order.

**Completion criterion:** The new provider is imported, added to `allProviders`, and imports remain alphabetically sorted.

### 3. Add the API key to example.env

In `example.env`, add a line for the provider's API key env var with a placeholder value. Keep entries roughly alphabetical.

```
<NAME>_API_KEY=sk-xxx
```

**Completion criterion:** A new line exists in `example.env` with the exact env var name from `apiKeyEnvVar` and a placeholder value.

### 4. Add a row to the README table

In `README.md`, under "Model Providers Config", add a row to the table:

```
| `<NAME>_API_KEY` | <DisplayName> | `<baseURL>` |
```

Match the column alignment of adjacent rows. Keep rows alphabetically sorted by variable name.

**Completion criterion:** A new row exists in the README table with all three columns filled and the row is alphabetically ordered.
