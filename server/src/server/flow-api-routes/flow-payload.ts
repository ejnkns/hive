/** @private — the whole-flow snapshot payload (config, workflows, instances,
 * status, ui declarations, available flow-level actions). */

import { getRegisteredFlowDefinition } from "../flow-definitions.ts";
import {
  getAvailableFlowActions,
  type getFlowRuntime,
} from "../flow-registry.ts";
import { computeInstanceStatus } from "../instance-status.ts";

export function flowPayload(
  flowId: string,
  runtime: NonNullable<ReturnType<typeof getFlowRuntime>>
) {
  const cfg = runtime.getFlowConfig();
  const workflows = runtime.getWorkflowDefinitions();
  const instances = runtime.getWorkflowInstanceEntries();
  // The raw definition TS source is internal (the server re-transpiles it on
  // rehydrate); it is not part of the client contract and must not ship to
  // every flow snapshot.
  const { definitionSource: _definitionSource, ...clientConfig } = cfg;
  // Flow-level rendering declarations come from the flow's definition (the
  // runtime carries only the resolved workflow configs). The UI uses them to
  // validate and fall back on custom render kinds.
  const definitionId = cfg.definitionId;
  const definition =
    typeof definitionId === "string"
      ? getRegisteredFlowDefinition(definitionId)
      : undefined;
  // Declared component ids mapped to their serve paths. The UI fetches each
  // module from this path, evaluates it, and registers the returned
  // components/kinds. A definition that no longer exists degrades to no
  // components (unknown instanceComponents fall back to the default card).
  const declaredComponents =
    typeof definitionId === "string"
      ? (definition?.flow.ui?.components ?? {})
      : {};
  const definitionSlug = typeof definitionId === "string" ? definitionId : "";
  const components = Object.fromEntries(
    Object.keys(declaredComponents).map((componentId) => [
      componentId,
      `/api/flows/definitions/${encodeURIComponent(definitionSlug)}/components/${encodeURIComponent(componentId)}`,
    ])
  );
  return {
    id: flowId,
    label: (cfg.name as string) ?? flowId,
    status: computeInstanceStatus(workflows, instances),
    config: clientConfig,
    workflows,
    instances,
    // Hidden definitions (the flow-authoring session) are driven by the
    // editor, not the flow library — the client hides their instances.
    hidden: definition?.hidden ?? false,
    ui: {
      kinds: definition?.flow.ui?.kinds ?? [],
      components,
      // Declarative theme tokens — the flow instance page themes its root
      // with these (one accent → both themes via color-mix).
      theme: definition?.flow.ui?.theme,
    },
    availableFlowActions: getAvailableFlowActions(flowId),
  };
}
