import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { afterEach, describe, it } from "node:test";
import type { FastifyServer } from "../create-server";
import { createServer } from "../create-server";

describe("chat completion route", () => {
  let server: FastifyServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("exposes the provider and model that served a playground response", async () => {
    const stream = new PassThrough();
    stream.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
    server = await createServer({
      getProviders: () => [],
      getProviderStates: async () => [],
      getLastUsed: () => ({ provider: null, model: null }),
      handleChatCompletion: async (_body, _headers, signal) => {
        assert.ok(signal);
        return {
          success: true,
          stream,
          provider: "provider-1",
          model: "model-1",
          statusCode: 200,
        };
      },
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "model-1",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-hive-provider"], "provider-1");
    assert.equal(response.headers["x-hive-model"], "model-1");
    assert.equal(response.headers["cache-control"], "no-cache");
  });
});
