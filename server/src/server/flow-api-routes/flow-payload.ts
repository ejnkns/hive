/** @private — the whole-flow snapshot payload (config, workflows, instances,
 * status, ui declarations, available flow-level actions). */

import {
  readPersistedDirectory,
  readPersistedOutput,
} from "workflow-engine/runners";
import {
  definitionModuleVersion,
  getRegisteredFlowDefinition,
} from "../flow-definitions.ts";
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
  // The module-set version (a stateless content hash of the entry + referenced
  // files) stamps the ref-form component paths, so a definition save changes
  // the URLs and busts the browser module cache. Inline-string components keep
  // the legacy single-blob route (no imports — nothing to version).
  const version = definitionModuleVersion(
    definition?.source ?? "",
    definition?.files
  );
  const components = Object.fromEntries(
    Object.entries(declaredComponents).map(([componentId, spec]) => {
      const base = `/api/flows/definitions/${encodeURIComponent(definitionSlug)}/components/${encodeURIComponent(componentId)}`;
      return [
        componentId,
        typeof spec === "string" ? base : `${base}?v=${version}`,
      ];
    })
  );
  // Persisted domain files the UI may read (declared by the definition as
  // ui.persistedOutputs / ui.persistedOutputDirs). Read through the engine's
  // persisted-output seam so resolution never drifts; a declared path that
  // escapes the domain root degrades to empty rather than breaking the
  // snapshot (the definition validator flags it as an advisory).
  const flowUi = definition?.flow.ui;
  const persistedOutputs: Record<string, string> = {};
  for (const path of flowUi?.persistedOutputs ?? []) {
    try {
      persistedOutputs[path] = readPersistedOutput(cfg, path);
    } catch {
      persistedOutputs[path] = "";
    }
  }
  const persistedOutputDirs: Record<string, Record<string, string>> = {};
  for (const dir of flowUi?.persistedOutputDirs ?? []) {
    try {
      persistedOutputDirs[dir] = readPersistedDirectory(cfg, dir);
    } catch {
      persistedOutputDirs[dir] = {};
    }
  }
  return {
    id: flowId,
    label: (cfg.name as string) ?? flowId,
    status: computeInstanceStatus(workflows, instances),
    config: clientConfig,
    workflows,
    instances,
    // The flow's revision stamp (runtime.getRevision): a monotonic counter
    // advanced by the runtime once per snapshot-affecting mutation and read
    // — never advanced — here at serialization, so equal stamps mean
    // identical content and re-delivery (reconnect init) holds the stamp.
    revision: runtime.getRevision(),
    // Hidden definitions (the flow-authoring session) are driven by the
    // editor, not the flow library — the client hides their instances.
    hidden: definition?.hidden ?? false,
    ui: {
      kinds: definition?.flow.ui?.kinds ?? [],
      components,
      // The flow-level custom component (the whole page body).
      flowComponent: definition?.flow.ui?.flowComponent,
      // Declarative theme tokens — the flow instance page themes its root
      // with these (one accent → both themes via color-mix).
      theme: definition?.flow.ui?.theme,
      ...(Object.keys(persistedOutputs).length > 0 ? { persistedOutputs } : {}),
      ...(Object.keys(persistedOutputDirs).length > 0
        ? { persistedOutputDirs }
        : {}),
    },
    availableFlowActions: getAvailableFlowActions(flowId),
  };
}
