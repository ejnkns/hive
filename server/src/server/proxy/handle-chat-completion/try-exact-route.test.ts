import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { ProviderRequestCancelledError } from "../provider-request-cancelled-error";
import { ProxyResponse } from "../proxy-response";
import { tryExactRoute } from "./try-exact-route";

describe("tryExactRoute", () => {
  it("returns null when no exact route was requested", async () => {
    let dispatched = false;
    const result = await tryExactRoute({
      exactNode: null,
      dispatch: async () => {
        dispatched = true;
        return ProxyResponse.error(500, "unexpected");
      },
      payloadStr: "{}",
      requestId: "request-1",
    });

    assert.equal(result, null);
    assert.equal(dispatched, false);
  });

  it("returns the selected provider and model without fallback", async () => {
    const stream = new PassThrough();
    stream.end("data: [DONE]\n\n");
    const result = await tryExactRoute({
      exactNode: { providerName: "provider-1", modelName: "model-1" },
      dispatch: async (node) => {
        assert.deepEqual(node, {
          providerName: "provider-1",
          modelName: "model-1",
        });
        return ProxyResponse.ok(200, stream);
      },
      payloadStr: "{}",
      requestId: "request-1",
    });

    assert.equal(result?.success, true);
    assert.equal(result?.provider, "provider-1");
    assert.equal(result?.model, "model-1");
  });

  it("surfaces the selected route failure instead of falling back", async () => {
    const result = await tryExactRoute({
      exactNode: { providerName: "provider-1", modelName: "model-1" },
      dispatch: async () => ProxyResponse.error(401, "invalid key"),
      payloadStr: "{}",
      requestId: "request-1",
    });

    assert.equal(result?.success, false);
    assert.equal(result?.statusCode, 401);
    assert.match(result?.error ?? "", /invalid key/);
  });

  it("surfaces a network failure instead of falling back", async () => {
    const result = await tryExactRoute({
      exactNode: { providerName: "provider-1", modelName: "model-1" },
      dispatch: async () => {
        throw new Error("connection refused");
      },
      payloadStr: "{}",
      requestId: "request-1",
    });

    assert.equal(result?.success, false);
    assert.equal(result?.statusCode, 502);
    assert.match(result?.error ?? "", /connection refused/);
  });

  it("stops exact routing when the downstream request is cancelled", async () => {
    const result = await tryExactRoute({
      exactNode: { providerName: "provider-1", modelName: "model-1" },
      dispatch: async () => {
        throw new ProviderRequestCancelledError();
      },
      payloadStr: "{}",
      requestId: "request-1",
    });

    assert.equal(result?.success, false);
    assert.equal(result?.statusCode, 499);
    assert.match(result?.error ?? "", /cancelled/);
  });
});
