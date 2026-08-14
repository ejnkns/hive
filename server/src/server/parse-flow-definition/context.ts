/** @private — the shared parse context every pass threads: the parsed entry,
 * the import binding map, the session's referenced files, the findings sink,
 * and the reference inventory collected in the renderer's own order. */

import type ts from "typescript";
import type { ModuleReference } from "../flow-blueprint.ts";

// An import line's binding: the symbol the entry uses at the use site and the
// module path it resolves to. A collision-disambiguated import
// (`import { x as x_2 }`) keeps both: exportName is the stub's declared name,
// binding is the symbol the use sites reference.
export type ImportBinding = { exportName: string; ref: string };

export type ParseContext = {
  sourceFile: ts.SourceFile;
  bindings: Map<string, ImportBinding>;
  files?: Record<string, string>;
  findings: string[];
  // The reference inventory, collected in the renderer's traversal order so a
  // re-render of the recovered blueprint emits the same imports in the same
  // order (byte-identity of the round-trip).
  refs: ModuleReference[];
};

export function refPathFor(
  context: ParseContext,
  binding: string
): string | undefined {
  return context.bindings.get(binding)?.ref;
}
