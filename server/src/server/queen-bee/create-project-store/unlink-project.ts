/** @private — only imported by create-project-store.ts */

import type { ProjectRegistry } from "../create-project-store";

export function unlinkProject(id: string, registry: ProjectRegistry): void {
  if (!(id in registry.projects)) {
    throw new Error(`Project not found: ${id}`);
  }
  delete registry.projects[id];
}
