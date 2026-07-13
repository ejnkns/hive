import assert from "node:assert";
import http from "node:http";
import https from "node:https";
import { describe, it, mock } from "node:test";
import { routeRequest } from "./route-request";

await describe("routeRequest abort", async () => {
  const baseOpts = {
    upstreamUrl: "https://api.example.com/v1/chat",
    mutated: {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
      },
      body: JSON.stringify({
        model: "test",
        messages: [{ role: "user", content: "hi" }],
      }),
    },
    timeoutMs: 5000,
    providerName: "test-provider",
    modelName: "test-model",
    requestId: "req-1",
  };

  await it("resolves with ABORTED when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await routeRequest({
      ...baseOpts,
      signal: controller.signal,
    });

    assert.strictEqual(result.proxyResponse.status, 0);
    assert.strictEqual(result.ttft, 0);
    assert.strictEqual(result.requestId, "req-1");
    const body = await result.proxyResponse.getBodyAsString();
    assert.strictEqual(body, "ABORTED");
  });

  await it("resolves with ABORTED when signal fires mid-request before response", async () => {
    const controller = new AbortController();

    const mockReq = {
      on: mock.fn(() => mockReq),
      write: mock.fn(),
      end: mock.fn(),
      destroy: mock.fn(() => {
        // simulate req.on("error") firing due to destroy
        const errorHandler = (
          mockReq.on as ReturnType<typeof mock.fn>
        ).mock.calls.find(
          (call: { arguments: unknown[] }) => call.arguments[0] === "error"
        );
        if (errorHandler) {
          const callback = errorHandler.arguments[1] as (err: Error) => void;
          callback(new Error("socket hang up"));
        }
      }),
    };

    mock.method(
      https,
      "request",
      () => mockReq as unknown as http.ClientRequest
    );

    const resultPromise = routeRequest({
      ...baseOpts,
      signal: controller.signal,
    });

    // allow the promise executor to run, req.write/req.end to be called
    await new Promise((r) => setTimeout(r, 0));

    controller.abort();

    const result = await resultPromise;

    assert.strictEqual(result.proxyResponse.status, 0);
    const body = await result.proxyResponse.getBodyAsString();
    assert.strictEqual(body, "ABORTED");

    mock.restoreAll();
  });

  await it("removes abort listener after resolve (avoid stale listeners)", async () => {
    const controller = new AbortController();
    const origAdd = controller.signal.addEventListener.bind(controller.signal);
    const origRemove = controller.signal.removeEventListener.bind(
      controller.signal
    );
    const listeners: ((...args: unknown[]) => void)[] = [];

    const signalMock = new Proxy(controller.signal, {
      get(target, prop) {
        if (prop === "addEventListener") {
          return (
            type: string,
            listener: (...args: unknown[]) => void,
            opts?: boolean | AddEventListenerOptions
          ) => {
            listeners.push(listener);
            return origAdd(type, listener, opts);
          };
        }
        if (prop === "removeEventListener") {
          return (type: string, listener: (...args: unknown[]) => void) => {
            const idx = listeners.indexOf(listener);
            if (idx !== -1) listeners.splice(idx, 1);
            return origRemove(type, listener);
          };
        }
        return Reflect.get(target, prop);
      },
    });

    const mockReq = {
      on: mock.fn(() => mockReq),
      write: mock.fn(),
      end: mock.fn(),
      destroy: mock.fn(),
    };

    mock.method(
      https,
      "request",
      (_opts: unknown, callback: (res: http.IncomingMessage) => void) => {
        const mockRes = new http.IncomingMessage(
          {} as unknown as import("node:net").Socket
        );
        mockRes.statusCode = 200;
        mockRes.headers = {};

        callback(mockRes);
        queueMicrotask(() => {
          mockRes.emit("data", Buffer.from("ok"));
        });

        return mockReq as unknown as http.ClientRequest;
      }
    );

    await routeRequest({
      ...baseOpts,
      signal: signalMock as unknown as AbortSignal,
    });

    assert.strictEqual(
      listeners.length,
      0,
      "abort listener should be cleaned up after resolve"
    );

    mock.restoreAll();
  });

  await it("cleans up abort listener after resolve (guard path)", async () => {
    const controller = new AbortController();
    controller.abort();

    const origRemove = controller.signal.removeEventListener.bind(
      controller.signal
    );
    const removedListeners: ((...args: unknown[]) => void)[] = [];
    const signalMock = new Proxy(controller.signal, {
      get(target, prop) {
        if (prop === "removeEventListener") {
          return (type: string, listener: (...args: unknown[]) => void) => {
            removedListeners.push(listener);
            return origRemove(type, listener);
          };
        }
        return Reflect.get(target, prop);
      },
    });

    await routeRequest({
      ...baseOpts,
      signal: signalMock as unknown as AbortSignal,
    });

    assert.strictEqual(removedListeners.length, 0); // guard path returns before adding any listener
  });

  await it("cleans up abort listener after normal resolve (http response path)", async () => {
    const controller = new AbortController();
    const origRemove = controller.signal.removeEventListener.bind(
      controller.signal
    );
    const removedListeners: ((...args: unknown[]) => void)[] = [];
    const signalMock = new Proxy(controller.signal, {
      get(target, prop) {
        if (prop === "removeEventListener") {
          return (type: string, listener: (...args: unknown[]) => void) => {
            removedListeners.push(listener);
            return origRemove(type, listener);
          };
        }
        return Reflect.get(target, prop);
      },
    });

    const mockReq = {
      on: mock.fn(() => mockReq),
      write: mock.fn(),
      end: mock.fn(),
      destroy: mock.fn(),
    };

    mock.method(
      https,
      "request",
      (_opts: unknown, callback: (res: http.IncomingMessage) => void) => {
        const mockRes = new http.IncomingMessage(
          {} as unknown as import("node:net").Socket
        );
        mockRes.statusCode = 200;
        mockRes.headers = {};

        callback(mockRes);
        queueMicrotask(() => {
          mockRes.emit("data", Buffer.from("ok"));
        });

        return mockReq as unknown as http.ClientRequest;
      }
    );

    await routeRequest({
      ...baseOpts,
      signal: signalMock as unknown as AbortSignal,
    });

    assert.ok(
      removedListeners.length > 0,
      "expected abort listener to be cleaned up"
    );

    mock.restoreAll();
  });

  await it("works identically when no signal is passed (backward compat)", async () => {
    const mockReq = {
      on: mock.fn(() => mockReq),
      write: mock.fn(),
      end: mock.fn(),
      destroy: mock.fn(),
    };

    mock.method(
      https,
      "request",
      (_opts: unknown, callback: (res: http.IncomingMessage) => void) => {
        const mockRes = new http.IncomingMessage(
          {} as unknown as import("node:net").Socket
        );
        mockRes.statusCode = 200;
        mockRes.headers = {};

        queueMicrotask(() => {
          callback(mockRes);
          mockRes.emit("data", Buffer.from("ok"));
        });

        return mockReq as unknown as http.ClientRequest;
      }
    );

    const result = await routeRequest(baseOpts);

    assert.strictEqual(result.proxyResponse.status, 200);
    assert.strictEqual(result.requestId, "req-1");

    mock.restoreAll();
  });
});
