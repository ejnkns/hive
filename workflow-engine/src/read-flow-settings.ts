// The flow-config path vocabulary — the ONE authority for where a flow's
// project root and domain root live. Flow config is static (set at creation;
// the server normalizes basePath to an absolute path, a tilde-expanded home
// path, or a hive-owned default workspace), so the engine only ever resolves
// already-absolute values — there is no cwd fallback and no relative-path
// re-derivation here or in any consumer.
//
// `readFlowSettings` returns the declared settings; `resolveFlowRoot` /
// `resolveDomainRoot` assert the invariant (absolute, present) with clear
// errors instead of silently degrading. A flow or consumer that needs the
// root routes through these, never through process.cwd().
import { isAbsolute, join } from "node:path";

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

// The flow's project root: basePath resolved once, asserted absolute. A
// missing or relative basePath is a creation-time error (the server always
// normalizes it), never a reason to fall back to the daemon's cwd.
export function resolveFlowRoot(flowConfig: Record<string, unknown>): string {
  const basePath = readString(flowConfig.basePath);
  if (basePath === undefined) {
    throw new Error("Flow config basePath is not set");
  }
  if (!isAbsolute(basePath)) {
    throw new Error(
      `Flow config basePath must be an absolute path (got "${basePath}") — the engine never resolves against the daemon's cwd`
    );
  }
  return basePath;
}

// The instance's domain root: basePath/<domainDir>. The definition declares
// domainDir (default .<definition-id>); the server copies it into the flow
// config at creation so the engine reads one source.
export function resolveDomainRoot(flowConfig: Record<string, unknown>): string {
  const domainDir = readFlowSettings(flowConfig).domainDir;
  if (domainDir === undefined) {
    throw new Error("Flow config domainDir is not set");
  }
  return join(resolveFlowRoot(flowConfig), domainDir);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
