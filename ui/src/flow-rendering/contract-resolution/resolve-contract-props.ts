/** @private — resolves a render contract's props against an output. */

import type { RenderContract } from "workflow-engine/workflow-types";
import { resolvePath } from "../resolve-path";
import { valueMatchesType } from "./validate";

export type ContractResolution =
  | { ok: true; props: Record<string, unknown> }
  | { ok: false };

// Resolves every contract prop against the output.
//
// Output-scoped props resolve against the whole output via the bound path; a
// bound prop that fails its type check is a mismatch (the caller falls back to
// json). Element-scoped props resolve against each item of the output array
// the "array" prop resolves to; a per-item path that does not resolve is kept
// as undefined (graceful) rather than a mismatch, since array data is
// heterogeneous. An unbound prop is simply absent.
export function resolveContractProps(input: {
  contract: RenderContract;
  output: unknown;
  props?: Record<string, string>;
}): ContractResolution {
  const bound = input.props ?? defaultProps(input.contract);
  const outputProps = input.contract.props.filter(
    (prop) => prop.scope === "output"
  );
  const elementProps = input.contract.props.filter(
    (prop) => prop.scope === "element"
  );
  const arrayProp = outputProps.find((prop) => prop.type === "array");

  const resolved: Record<string, unknown> = {};

  for (const prop of outputProps) {
    const path = bound[prop.name];
    if (path === undefined) continue;
    const value = resolvePath(input.output, path);
    if (!valueMatchesType(value, prop.type)) return { ok: false };
    resolved[prop.name] = value;
  }

  if (elementProps.length > 0) {
    if (arrayProp === undefined || bound[arrayProp.name] === undefined) {
      return { ok: false };
    }
    const arrayValue = resolved[arrayProp.name];
    if (!Array.isArray(arrayValue)) return { ok: false };
    resolved[arrayProp.name] = arrayValue.map((item) => {
      const element: Record<string, unknown> = {};
      for (const prop of elementProps) {
        const path = bound[prop.name];
        if (path === undefined) continue;
        element[prop.name] = resolvePath(item, path);
      }
      return element;
    });
  }

  return { ok: true, props: resolved };
}

// When a hint omits props entirely, a kind with exactly one output-scoped prop
// and no element props (markdown/text) binds that prop to the root — a plain
// string output renders directly.
function defaultProps(contract: RenderContract): Record<string, string> {
  const outputProps = contract.props.filter((prop) => prop.scope === "output");
  if (
    outputProps.length === 1 &&
    contract.props.every((prop) => prop.scope === "output")
  ) {
    return { [outputProps[0].name]: "" };
  }
  return {};
}
