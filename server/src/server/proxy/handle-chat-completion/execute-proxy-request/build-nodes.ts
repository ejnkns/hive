import type { Node } from "telemetry";
import type { Provider } from "../../../providers/providers";
import { getModelId } from "../../../providers/providers";

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
