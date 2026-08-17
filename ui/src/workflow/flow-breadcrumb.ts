/** The shell-owned breadcrumb for flow routes: the full crumb path rendered in
 * the top bar for every flow route, so a flow page's own header carries no
 * duplicate breadcrumb. Pure function — the shell (App.svelte) drives it. */

// The flow route shape parsed from the URL hash (moved out of App.svelte so
// the breadcrumb helper and the shell share one authority).
export type FlowRoute =
  | { kind: "library" }
  | { kind: "new-definition" }
  | { kind: "definition"; flowName: string }
  | { kind: "edit-definition"; flowName: string }
  | { kind: "view-definition"; flowName: string }
  | { kind: "new-instance"; flowName: string }
  | { kind: "instance"; flowName: string; instanceName: string };

export type Breadcrumb = {
  label: string;
  href?: string;
};

// The crumb path for a flow route. The leaf is the current location (no href);
// intermediate crumbs link back up the path. `instanceLabel` is the resolved
// pretty instance name for the `instance` route — before the flow snapshot
// arrives the helper falls back to the route's slug.
export function flowBreadcrumb(
  route: FlowRoute,
  instanceLabel?: string
): Breadcrumb[] {
  const flows: Breadcrumb = { label: "flows", href: "#/flows" };
  const flow = (flowName: string): Breadcrumb => ({
    label: flowName,
    href: `#/flows/${encodeURIComponent(flowName)}`,
  });

  switch (route.kind) {
    case "library":
      return [];
    case "new-definition":
      return [flows, { label: "new" }];
    case "definition":
      return [flows, { label: route.flowName }];
    case "edit-definition":
      return [flows, flow(route.flowName), { label: "edit" }];
    case "view-definition":
      return [flows, flow(route.flowName), { label: "view" }];
    case "new-instance":
      return [flows, flow(route.flowName), { label: "new" }];
    case "instance":
      return [
        flows,
        flow(route.flowName),
        { label: instanceLabel ?? route.instanceName },
      ];
  }
}
