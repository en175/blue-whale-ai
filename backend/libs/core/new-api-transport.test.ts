import { describe, expect, it } from "vitest";

import {
  NewApiError,
  NewApiNetworkError,
  NewApiTimeoutError,
  createNewApiRawRequest,
} from "./new-api-transport.js";

describe("createNewApiRawRequest（IKDQ5F）", () => {
  it("保留 status + 原文 + 响应头 + requestId，不做信封解析", async () => {
    const rawRequest = createNewApiRawRequest({
      baseUrl: "http://new-api.test",
      fetchImpl: async () =>
        new Response("new-api 音频生成余额不足", {
          status: 200,
          headers: { "X-Oneapi-Request-Id": "req-1", "Content-Type": "text/plain" },
        }),
    });
    const result = await rawRequest("/v1/audio/speech", { method: "POST" }, "sk-t");
    expect(result.status).toBe(200);
    expect(result.text).toBe("new-api 音频生成余额不足");
    expect(result.requestId).toBe("req-1");
    expect(result.headers.get("content-type")).toBe("text/plain");
  });

  it("非 2xx 也返回原文与状态码（不抛错、不上抛业务失败）", async () => {
    const rawRequest = createNewApiRawRequest({
      baseUrl: "http://new-api.test",
      fetchImpl: async () =>
        new Response("上游网关超时，请稍后重试", {
          status: 504,
          headers: { "Content-Type": "text/plain" },
        }),
    });
    const result = await rawRequest("/v1/audio/speech", { method: "POST" }, "sk-t");
    expect(result.status).toBe(504);
    expect(result.text).toContain("网关超时");
  });

  it("注入 X-Trace-Id 与 X-Client-System 出站头（与 performRequest 同构）", async () => {
    let capturedHeaders: Headers | null = null;
    const rawRequest = createNewApiRawRequest({
      baseUrl: "http://new-api.test",
      fetchImpl: async (_input, init = {}) => {
        capturedHeaders = new Headers(init.headers);
        return new Response("{}", { status: 200 });
      },
    });
    await rawRequest("/v1/audio/speech", { method: "POST" }, "sk-t");
    expect(capturedHeaders?.get("authorization")).toBe("Bearer sk-t");
    expect(capturedHeaders?.get("X-Trace-Id")).toBeTruthy();
    expect(capturedHeaders?.get("X-Client-System")).toBe("bluewhale");
  });

  it("超时（timeoutMs 内未返回）→ NewApiTimeoutError（instanceof NewApiError 且 status 503）", async () => {
    const rawRequest = createNewApiRawRequest({
      baseUrl: "http://new-api.test",
      timeoutMs: 50,
      fetchImpl: (_input, init = {}) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init.signal ?? null) as AbortSignal | null;
          const abortHandler = () => reject(new DOMException("Aborted", "AbortError"));
          signal?.addEventListener("abort", abortHandler, { once: true });
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abortHandler);
            resolveLate();
          }, 200);
          function resolveLate() {}
          void timer;
          void resolveLate;
        }),
    });
    const error = await rawRequest("/v1/audio/speech", { method: "POST" }, "sk-t").then(
      () => null,
      (e) => e as unknown,
    );
    expect(error).toBeInstanceOf(NewApiTimeoutError);
    expect(error).toBeInstanceOf(NewApiError);
    expect((error as NewApiTimeoutError).status).toBe(503);
    expect((error as NewApiTimeoutError).code).toBe("timeout");
  });

  it("fetch 网络不可达 → NewApiNetworkError（instanceof NewApiError，status 503 / code unreachable）", async () => {
    const rawRequest = createNewApiRawRequest({
      baseUrl: "http://new-api.test",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await rawRequest("/v1/audio/speech", { method: "POST" }, "sk-t").then(
      () => null,
      (e) => e as unknown,
    );
    expect(error).toBeInstanceOf(NewApiNetworkError);
    expect(error).toBeInstanceOf(NewApiError);
    expect((error as NewApiNetworkError).status).toBe(503);
    expect((error as NewApiNetworkError).code).toBe("unreachable");
    expect((error as NewApiNetworkError).cause).toBeInstanceOf(TypeError);
  });

  it("fetch 网络不可达（信封路径）→ NewApiNetworkError（cause 链原错误）", async () => {
    const { createNewApiClient } = await import("./new-api-client.js");
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await client.getVideoTask("sk-t", "task-1").then(
      () => null,
      (e) => e as unknown,
    );
    expect(error).toBeInstanceOf(NewApiNetworkError);
    expect(error).toBeInstanceOf(NewApiError);
    expect((error as NewApiNetworkError).status).toBe(503);
    expect((error as NewApiNetworkError).code).toBe("unreachable");
    expect((error as NewApiNetworkError).cause).toBeInstanceOf(TypeError);
  });
});
