/** @public — composition root: registers the built-in flow definitions the server ships. */

import { queenBeeFlow } from "../../../presets/queen-bee/flow";
import { wayfinderFlow } from "../../../presets/wayfinder/flow";
import { authoringSessionFlow } from "../server/flow-authoring";
import { registerFlowDefinition } from "../server/flow-definitions";

export function registerBuiltinFlowDefinitions(): void {
  registerFlowDefinition(queenBeeFlow, { builtIn: true });
  registerFlowDefinition(wayfinderFlow, { builtIn: true });
  // The flow-authoring session is a built-in definition but never shown in
  // the flow library — the definition editor drives it directly.
  registerFlowDefinition(authoringSessionFlow, { builtIn: true, hidden: true });
}
