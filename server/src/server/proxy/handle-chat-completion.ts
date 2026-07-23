import type { Readable } from "node:stream";
import { generateId } from "shared/generate-id";
import { logger } from "shared/logger";
import type { Message } from "shared/message";
import { conversationStore, loadCache, type Node } from "telemetry";
import { buildPromptPreview } from "./handle-chat-completion/build-prompt-preview";
import { dispatchRequest } from "./handle-chat-completion/dispatch-request";
import { executeProxyRequest } from "./handle-chat-completion/execute-proxy-request";
import { buildNodes } from "./handle-chat-completion/execute-proxy-request/build-nodes";
import { extractRequiredFeatures } from "./handle-chat-completion/execute-proxy-request/extract-required-features";
import { getMetricsForNode } from "./handle-chat-completion/execute-proxy-request/get-metrics-for-node";
import { filterHeaders } from "./handle-chat-completion/filter-headers";
import { resolveSessionId } from "./handle-chat-completion/resolve-session-id";
import { tryExactRoute } from "./handle-chat-completion/try-exact-route";
import { tryOverrideRoute } from "./handle-chat-completion/try-override-route";
import { tryPresetRoute } from "./handle-chat-completion/try-preset-route";
import { setLastUsed } from "./last-used-state";
import { getPresetsConfig } from "./presets-config";
import { isProviderRequestCancelledError } from "./provider-request-cancelled-error";
import { getProviders } from "./providers-state";
import type { ProxyResponse } from "./proxy-response";
import { routingMemory } from "./routing-memory";
import { getServerState } from "./server-state";
import { recordRequestReceived } from "./session-aggregator";

export type ChatCompletionResult = {
  success: boolean;
  stream?: Readable;
  provider?: string;
  model?: string;
  statusCode?: number;
  error?: string;
};

export async function handleChatCompletion(
  body: string | Record<string, unknown>,
  incomingHeaders: Record<string, string | string[] | undefined> = {},
  signal?: AbortSignal
): Promise<ChatCompletionResult> {
  const state = getServerState();
  const exactRoute = parseExactDiagnosticRoute(incomingHeaders);
  const playgroundAuto =
    headerValue(incomingHeaders["x-hive-playground-mode"]) === "auto";
  if (!exactRoute.valid) {
    return {
      success: false,
      statusCode: 400,
      error: exactRoute.error,
    };
  }
  const exactNode = exactRoute.node;
  const parsed:
    | Record<string, unknown>
    | { messages?: Array<Record<string, unknown>> } =
    typeof body === "string"
      ? (JSON.parse(body) as Record<string, unknown>)
      : body;

  const qualified = getProviders().filter((p) => {
    const key = process.env[p.apiKeyEnvVar];
    return key && key.length > 0 && !state.isProviderDisabled(p.name);
  });

  if (exactNode && !qualified.some((p) => p.name === exactNode.providerName)) {
    return {
      success: false,
      provider: exactNode.providerName,
      model: exactNode.modelName,
      statusCode: 503,
      error: `Selected playground provider '${exactNode.providerName}' is unavailable`,
    };
  }

  if (qualified.length === 0) {
    logger.debug("no configured providers available — set a provider API key");
    return {
      success: false,
      statusCode: 503,
      error: "No configured providers available — set a provider API key",
    };
  }

  const cache = await loadCache();
  const requestId = generateId();
  const messages = (parsed as Record<string, unknown>).messages ?? [];
  const typedMessages = Array.isArray(messages) ? (messages as Message[]) : [];

  const sessionId = resolveSessionId(incomingHeaders, typedMessages);

  const payloadStr = JSON.stringify(parsed);

  const lastMsg = typedMessages.at(-1);

  const promptPreview = buildPromptPreview(lastMsg);
  recordRequestReceived({
    requestId,
    sessionId,
    timestamp: Date.now(),
    promptPreview,
  });

  const requiredFeatures = extractRequiredFeatures(parsed);

  logger.debug(
    `request ${requestId} — ${String(qualified.length)} qualified providers, ${requiredFeatures.length > 0 ? `required features: [${requiredFeatures.join(", ")}]` : "no required features"}`
  );

  conversationStore.startConversation(
    requestId,
    Array.isArray(messages)
      ? (messages as { role: string; content: string }[])
      : []
  );

  const nodes = buildNodes(qualified);

  const headers = filterHeaders(incomingHeaders);

  logger.debug(
    `request ${requestId} — upstream payload (first 500): ${payloadStr.slice(0, 500)}`
  );

  const boundGetMetricsForNode = (compoundKey: string) =>
    getMetricsForNode(compoundKey, cache);

  const boundDispatchRequest = async (
    node: Node,
    payload: string
  ): Promise<ProxyResponse> =>
    dispatchRequest(node, payload, qualified, headers, requestId, signal);

  const exactResult = await tryExactRoute({
    exactNode,
    dispatch: boundDispatchRequest,
    payloadStr,
    requestId,
    onSuccess: (provider, model) => setLastUsed(provider, model),
  });
  if (exactResult) return exactResult;

  const override = playgroundAuto ? null : state.getOverride();
  const overrideNode =
    override && qualified.some((p) => p.name === override.provider)
      ? { providerName: override.provider, modelName: override.model }
      : null;

  const overrideResult = await tryOverrideRoute({
    overrideNode,
    dispatch: boundDispatchRequest,
    payloadStr,
    requestId,
    onSuccess: (provider, model) => setLastUsed(provider, model),
  });
  if (overrideResult) return overrideResult;

  const presets = getPresetsConfig();
  if (presets) {
    const presetResult = await tryPresetRoute({
      modelPriority: presets.modelPriority,
      providerPriority: presets.providerPriority,
      nodes,
      dispatch: boundDispatchRequest,
      payloadStr,
      requestId,
      getMetricsForNode: boundGetMetricsForNode,
      sessionId,
      onSuccess: (provider, model) => setLastUsed(provider, model),
    });
    if (presetResult) return presetResult;
  }

  let response: ProxyResponse | null;

  try {
    response = await executeProxyRequest({
      nodes,
      originalPayload: payloadStr,
      requiredFeatures,
      getMetricsForNode: boundGetMetricsForNode,
      dispatchRequest: boundDispatchRequest,
      sessionId,
    });
  } catch (err: unknown) {
    if (isProviderRequestCancelledError(err)) {
      return { success: false, statusCode: 499, error: err.message };
    }
    logger.error(`request ${requestId} — all providers failed`, err);
    return {
      success: false,
      statusCode: 503,
      error: "All providers failed",
    };
  }

  if (response.isOk()) {
    const lastKey = routingMemory.getNodeAffinity(sessionId);
    const usedNode =
      nodes.find((n) => lastKey === `${n.providerName}:${n.modelName}`) ?? null;
    const provider = usedNode?.providerName ?? null;
    const model = usedNode?.modelName ?? null;
    setLastUsed(provider, model);

    logger.debug(
      `request ${requestId} — success via ${provider ?? "??"}:${model ?? "??"}`
    );

    return {
      success: true,
      stream: response.getStream(),
      provider: provider ?? undefined,
      model: model ?? undefined,
      statusCode: response.status,
    };
  }

  logger.debug(
    `request ${requestId} — upstream returned no stream (status ${String(response.status)})`
  );

  return {
    success: false,
    statusCode: response.status,
    error: "Upstream returned no stream",
  };
}

type ExactDiagnosticRoute =
  | { valid: true; node: Node | null }
  | { valid: false; error: string };

function parseExactDiagnosticRoute(
  headers: Record<string, string | string[] | undefined>
): ExactDiagnosticRoute {
  const providerName = headerValue(headers["x-hive-playground-provider"]);
  const modelName = headerValue(headers["x-hive-playground-model"]);
  if ((providerName && !modelName) || (!providerName && modelName)) {
    return {
      valid: false,
      error: "Exact playground routing requires both provider and model",
    };
  }
  return {
    valid: true,
    node: providerName && modelName ? { providerName, modelName } : null,
  };
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => item.trim());
    return first?.trim() ?? null;
  }
  return null;
}
