import { PassThrough } from "node:stream";
import { routeRequest } from "./route-request";
import { mutateRequest } from "./mutate-request";
import { telemetryRecorder } from "../telemetry/recorder";
import type { Provider } from "../providers/registry";
import type { IncomingMessage } from "node:http";
import { logger } from "../hive/shared/logger";

export type FailoverResult = {
  success: boolean;
  provider?: string;
  model?: string;
  stream?: PassThrough;
  statusCode?: number;
  errorBody?: string;
};

const TIMEOUT_MS = 10000;

export async function failover(
  providers: Provider[],
  originalHeaders: IncomingMessage["headers"],
  originalBody: string,
): Promise<FailoverResult> {
  for (const provider of providers) {
    const model = provider.defaultModel;
    logger.info(`failover: trying ${provider.name} (${model})`);
    let mutated: ReturnType<typeof mutateRequest>;
    try {
      mutated = mutateRequest(originalHeaders, originalBody, provider, model);
    } catch (err: any) {
      logger.error(
        `failover: mutate request failed for ${provider.name}: ${err.message}`,
      );
      telemetryRecorder.recordMetric({
        provider: provider.name,
        model,
        ttft: TIMEOUT_MS,
        statusCode: 0,
        success: false,
        timestamp: Date.now(),
      });
      continue;
    }

    const result = await routeRequest(
      `${provider.baseUrl}/v1/chat/completions`,
      mutated,
      TIMEOUT_MS,
      provider.name,
      model,
    );

    if (result.success && result.statusCode < 400) {
      return {
        success: true,
        provider: provider.name,
        model,
        stream: result.stream!,
        statusCode: result.statusCode,
      };
    }

    logger.error(
      `failover: ${provider.name} failed — status ${result.statusCode}${result.errorBody ? `: ${result.errorBody.slice(0, 250)}` : ""}${result.errorType ? ` (${result.errorType})` : ""}`,
    );

    telemetryRecorder.recordMetric({
      provider: provider.name,
      model,
      ttft: result.ttft,
      statusCode: result.statusCode,
      success: false,
      timestamp: Date.now(),
    });
  }

  logger.error(`failover: all ${providers.length} providers exhausted`);
  return { success: false, statusCode: 503 };
}
