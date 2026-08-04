/** @public — resolve a render hint to concrete renderer props, with json fallback. */

import {
  type BuiltinRenderKind,
  builtinRenderContracts,
  type CustomRenderKind,
  type RenderContract,
  type RuntimeRenderHint,
} from "workflow-engine/workflow-types";
import { resolveContractProps } from "./contract-resolution/resolve-contract-props";

export type ResolvedRender = {
  kind: string;
  props: Record<string, unknown>;
};

// The single interface of the contract-resolution runtime: given a task
// output (or display field value), a render hint, and the flow's custom kinds,
// produce the concrete props a renderer of `kind` consumes. Unknown kinds and
// contract mismatches never throw — they resolve to the json kind with the raw
// output, which the default components always render.
export function resolveRender(input: {
  output: unknown;
  hint: RuntimeRenderHint;
  customKinds?: readonly CustomRenderKind[];
}): ResolvedRender {
  const contract = findRenderContract(input.hint.kind, input.customKinds ?? []);
  if (contract === undefined) return jsonRender(input.output);
  if (input.hint.kind === "json") return jsonRender(input.output);

  const resolved = resolveContractProps({
    contract,
    output: input.output,
    props: input.hint.props,
  });
  if (!resolved.ok) return jsonRender(input.output);
  // A hint that resolves to no props is vacuous (e.g. `{ kind: "card" }` with
  // nothing bound) — a blank render would hide the raw output, so fall back.
  if (Object.keys(resolved.props).length === 0 && contract.props.length > 0) {
    return jsonRender(input.output);
  }
  return { kind: input.hint.kind, props: resolved.props };
}

export function findRenderContract(
  kind: string,
  customKinds: readonly CustomRenderKind[]
): RenderContract | undefined {
  if (kind in builtinRenderContracts) {
    // The `in` check guarantees the key exists; the cast reads a concrete
    // builtin contract, which `as const satisfies` has typed by literal kind.
    return builtinRenderContracts[kind as BuiltinRenderKind];
  }
  return customKinds.find((custom) => custom.kind === kind)?.contract;
}

function jsonRender(output: unknown): ResolvedRender {
  return { kind: "json", props: { value: output } };
}
