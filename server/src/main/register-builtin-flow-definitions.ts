/** @public — composition root: registers the built-in flow definitions the server ships. */

import { registerFlowDefinition } from "../server/flow-registry";
import { queenBeeFlowDefinition } from "../server/queen-bee";

export function registerBuiltinFlowDefinitions(): void {
  registerFlowDefinition(queenBeeFlowDefinition);
}
