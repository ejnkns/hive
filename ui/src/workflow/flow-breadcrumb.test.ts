// The shell breadcrumb derivation: every flow route's full crumb path, the
// instance slug fallback, and the pretty-name override.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flowBreadcrumb } from "./flow-breadcrumb.ts";

describe("flowBreadcrumb", () => {
  it("the library has no breadcrumb", () => {
    assert.deepEqual(flowBreadcrumb({ kind: "library" }), []);
  });

  it("new-definition is flows / new", () => {
    assert.deepEqual(flowBreadcrumb({ kind: "new-definition" }), [
      { label: "flows", href: "#/flows" },
      { label: "new" },
    ]);
  });

  it("definition is flows / <name> with the name as the current leaf", () => {
    assert.deepEqual(
      flowBreadcrumb({ kind: "definition", flowName: "wayfinder" }),
      [{ label: "flows", href: "#/flows" }, { label: "wayfinder" }]
    );
  });

  it("edit / view / new-instance link the flow and end on the action", () => {
    for (const kind of [
      "edit-definition",
      "view-definition",
      "new-instance",
    ] as const) {
      const leaf =
        kind === "new-instance"
          ? "new"
          : kind === "edit-definition"
            ? "edit"
            : "view";
      assert.deepEqual(flowBreadcrumb({ kind, flowName: "wayfinder" }), [
        { label: "flows", href: "#/flows" },
        { label: "wayfinder", href: "#/flows/wayfinder" },
        { label: leaf },
      ]);
    }
  });

  it("instance falls back to the route slug when no pretty name is resolved", () => {
    assert.deepEqual(
      flowBreadcrumb({
        kind: "instance",
        flowName: "wayfinder",
        instanceName: "hive-effect",
      }),
      [
        { label: "flows", href: "#/flows" },
        { label: "wayfinder", href: "#/flows/wayfinder" },
        { label: "hive-effect" },
      ]
    );
  });

  it("instance uses the resolved pretty name when provided", () => {
    assert.deepEqual(
      flowBreadcrumb(
        {
          kind: "instance",
          flowName: "wayfinder",
          instanceName: "hive-effect",
        },
        "hive effect"
      ),
      [
        { label: "flows", href: "#/flows" },
        { label: "wayfinder", href: "#/flows/wayfinder" },
        { label: "hive effect" },
      ]
    );
  });

  it("encodes flow names in links", () => {
    assert.deepEqual(
      flowBreadcrumb({
        kind: "instance",
        flowName: "my flow",
        instanceName: "x",
      }),
      [
        { label: "flows", href: "#/flows" },
        { label: "my flow", href: "#/flows/my%20flow" },
        { label: "x" },
      ]
    );
  });
});
