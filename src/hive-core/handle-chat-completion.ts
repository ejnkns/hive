/** @public — handle-chat-completion module API. Import from here, not from handle-chat-completion/ directly. */

import type { PassThrough } from "node:stream";
import {
  emitFlowEvent,
  executeProxyRequest,
  type ProxyResponse,
  routingMemory,
} from "../proxy";
import { getOverride, isProviderDisabled } from "../server";
import { logger } from "../shared/logger";
import { conversationStore, loadCache, type Node } from "../telemetry";
import { generateId } from "./generate-id";
import { buildNodes } from "./handle-chat-completion/build-nodes";
import { buildPromptPreview } from "./handle-chat-completion/build-prompt-preview";
import { detectAndInjectLoopMessages } from "./handle-chat-completion/detect-and-inject-loop-messages";
import { dispatchRequest } from "./handle-chat-completion/dispatch-request";
import { extractRequiredFeatures } from "./handle-chat-completion/extract-required-features";
import { filterHeaders } from "./handle-chat-completion/filter-headers";
import { getMetricsForNode } from "./handle-chat-completion/get-metrics-for-node";
import { resolveSessionId } from "./handle-chat-completion/resolve-session-id";
import { tryOverrideRoute } from "./handle-chat-completion/try-override-route";
import { setLastUsed } from "./last-used-state";
import type { Message } from "./message";
import { getProviders } from "./providers-state";

export type ChatCompletionResult = {
  success: boolean;
  stream?: PassThrough;
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
  let parsed:
    | Record<string, unknown>
    | { messages?: Array<Record<string, unknown>> } =
    typeof body === "string"
      ? (JSON.parse(body) as Record<string, unknown>)
      : body;

  const qualified = getProviders().filter((p) => {
    const key = process.env[p.apiKeyEnvVar];
    return key && key.length > 0 && !isProviderDisabled(p.name);
  });

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

  const loopResult = detectAndInjectLoopMessages(parsed, typedMessages);
  parsed = loopResult.parsed;
  const toolLoopDetected = loopResult.toolLoopDetected;
  const payloadStr = JSON.stringify(parsed);

  const lastMsg = typedMessages.at(-1);

  const promptPreview = buildPromptPreview(lastMsg);
  emitFlowEvent({
    type: "request_received",
    requestId,
    sessionId,
    timestamp: Date.now(),
    promptPreview,
    toolLoopDetected,
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

  const boundGetMetricsForNode = (compoundKey: string) =>
    getMetricsForNode(compoundKey, cache);

  const boundDispatchRequest = async (
    node: Node,
    payload: string
  ): Promise<ProxyResponse> =>
    dispatchRequest(node, payload, qualified, headers, requestId, signal);

  const override = getOverride();
  const overrideNode =
    override && qualified.some((p) => p.name === override.provider)
      ? { providerName: override.provider, modelName: override.model }
      : null;

  const overrideResult = await tryOverrideRoute({
    overrideNode,
    dispatch: boundDispatchRequest,
    payloadStr,
    requestId,
  });
  if (overrideResult) return overrideResult;
  let response: ProxyResponse | null;

  try {
    response = await executeProxyRequest({
      nodes,
      originalPayload: payloadStr,
      requiredFeatures,
      getMetricsForNode: boundGetMetricsForNode,
      dispatchRequest: boundDispatchRequest,
      sessionId,
      signal,
    });
  } catch (err: unknown) {
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
      stream: response.getStream() as PassThrough,
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
