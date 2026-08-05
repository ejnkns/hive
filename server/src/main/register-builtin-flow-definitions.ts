/** @public — composition root: registers the built-in flow definitions the server ships. */

import { queenBeeFlow } from "../../../presets/queen-bee/flow";
import { wayfinderFlow } from "../../../presets/wayfinder/flow";
import { registerFlowDefinition } from "../server/flow-definitions";

export function registerBuiltinFlowDefinitions(): void {
  registerFlowDefinition(queenBeeFlow, { builtIn: true });
  registerFlowDefinition(wayfinderFlow, { builtIn: true });
}
