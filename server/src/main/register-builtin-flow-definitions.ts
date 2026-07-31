/** @public — composition root: registers the built-in flow definitions the server ships. */

import { queenBeeFlow } from "../../../presets/queen-bee/flow";
import { registerFlowDefinition } from "../server/flow-registry";

export function registerBuiltinFlowDefinitions(): void {
  registerFlowDefinition(queenBeeFlow);
}
