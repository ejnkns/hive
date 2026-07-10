/** @internal */

import type { Provider } from "../../providers";
import { getModelId } from "../../providers";
import type { Node } from "../../telemetry";

export function buildNodes(qualified: ReadonlyArray<Provider>): Node[] {
  return qualified.map((p) => {
    const defaultEntry = p.models.find(
      (entry) => getModelId(entry) === p.defaultModel
    );
    return {
      providerName: p.name,
      modelName: p.defaultModel,
      maxContextTokens:
        defaultEntry && typeof defaultEntry !== "string"
          ? defaultEntry.contextLength
          : undefined,
    };
  });
}
