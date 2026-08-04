import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ElementConstructor,
  getComponentRenderer,
  getKindRenderer,
  registerComponentRenderer,
  registerKindRenderer,
} from "./renderer-registry";

// The registry only touches the element classes as constructor values, so a
// plain dummy class exercises it without pulling Lit into the Node test.
class DummyElement {}

// Casting the dummy to the constructor type is test-only: the registry stores
// whatever constructor is registered and returns it on lookup.
const dummy = DummyElement as unknown as ElementConstructor;
const other = class OtherElement {} as unknown as ElementConstructor;

describe("renderer registry", () => {
  it("resolves registered render kinds", () => {
    registerKindRenderer("json", dummy);
    assert.equal(getKindRenderer("json"), dummy);
  });

  it("returns undefined for an unknown render kind", () => {
    assert.equal(getKindRenderer("not-registered"), undefined);
  });

  it("resolves registered component ids and falls back to undefined", () => {
    registerComponentRenderer("my-card", dummy);
    assert.equal(getComponentRenderer("my-card"), dummy);
    assert.equal(getComponentRenderer("unknown-id"), undefined);
    assert.equal(getComponentRenderer(undefined), undefined);
  });

  it("later registrations replace earlier ones", () => {
    registerComponentRenderer("swapped", dummy);
    registerComponentRenderer("swapped", other);
    assert.equal(getComponentRenderer("swapped"), other);
  });
});
