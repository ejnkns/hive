// Flow-config fields the engine's git and persistence operations read instead
// of hardcoded names. basePath is the optional repo binding; domainDir defaults
// to .<definition-id> (never stored definition-global state). integrationBranch
// and branchPrefix are required for git-capable flows and have NO fallback —
// a flow must declare them explicitly (queen-bee wires them in a later phase).
export type FlowSettings = {
  basePath?: string;
  domainDir?: string;
  integrationBranch?: string;
  branchPrefix?: string;
};

export function readFlowSettings(
  flowConfig: Record<string, unknown>
): FlowSettings {
  const basePath = readString(flowConfig.basePath);
  const definitionId =
    typeof flowConfig.definitionId === "string" &&
    flowConfig.definitionId !== ""
      ? flowConfig.definitionId
      : undefined;
  return {
    basePath,
    domainDir:
      readString(flowConfig.domainDir) ??
      (definitionId ? `.${definitionId}` : undefined),
    integrationBranch: readString(flowConfig.integrationBranch),
    branchPrefix: readString(flowConfig.branchPrefix),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
