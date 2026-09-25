// IK74V8：从 new-api-client.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
//
// ⚠️ 账号面（能力探测 / 注册 / 登录 / Token 身份复核 / 改密）的用例已随这些 ops 一起
//    删除：new-api 降级成带一把统一 key 的上游供应商后，身份类读写不再走它。
import {describe, expect, it} from "vitest";

import {
  NewApiError,
  CLIENT_SYSTEM_BLUEWHALE,
  createNewApiClient,
} from "./new-api-client.js";
import {createNewApiRequest} from "./new-api-transport.js";
import {jsonResponse} from "./new-api-client.testlib.js";

describe("new-api client —— Token 面查询与错误映射", () => {
  it("declares the bluewhale client system on every outbound request", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test/",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/api/usage/token/")) {
          return jsonResponse({ code: true, data: { user_quota: 99 } });
        }
        return jsonResponse({ success: true, message: "", data: [] });
      },
    });

    await client.getTokenUsage("sk-1");
    await client.getTokenLogs("sk-1");
    await client.generateImages("sk-1", { model: "m", prompt: "p", n: 1 });

    expect(requests).toHaveLength(3);
    for (const { init } of requests) {
      expect(new Headers(init.headers).get("X-Client-System")).toBe(
        CLIENT_SYSTEM_BLUEWHALE,
      );
    }
  });

  it("lets a caller-supplied X-Client-System header win over the default", async () => {
    const captured: Array<RequestInit> = [];
    const request = createNewApiRequest({
      baseUrl: "http://new-api.test/",
      fetchImpl: async (input, init = {}) => {
        captured.push(init);
        return jsonResponse({ code: true, data: { user_quota: 99 } });
      },
    });

    await request("/api/usage", {
      headers: { "X-Client-System": "api" },
    });
    await request("/api/usage");

    expect(new Headers(captured[0]?.headers).get("X-Client-System")).toBe(
      "api",
    );
    expect(new Headers(captured[1]?.headers).get("X-Client-System")).toBe(
      CLIENT_SYSTEM_BLUEWHALE,
    );
  });

  it("normalizes network failure to 503 and malformed usage data to 502", async () => {
    const unreachable = createNewApiClient({
      baseUrl: "http://internal-new-api.test",
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED http://internal-new-api.test");
      },
    });
    await expect(unreachable.getTokenUsage("sk-1")).rejects.toMatchObject({
      status: 503,
      message: "new-api 不可达",
    });

    const malformed = createNewApiClient({
      baseUrl: "http://internal-new-api.test",
      fetchImpl: async () => jsonResponse({ success: true, data: {} }),
    });
    await expect(malformed.getTokenUsage("sk-1")).rejects.toMatchObject({
      status: 502,
      code: "invalid_usage_response",
    });
  });

  it("aborts account requests at the configured timeout and reports 503", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      timeoutMs: 5,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });

    await expect(client.getTokenUsage("sk-1")).rejects.toMatchObject({
      status: 503,
      message: "new-api 不可达",
    });
  });

  it("keeps the timeout active while the response body is being read", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      timeoutMs: 5,
      fetchImpl: async (_input, init) => {
        const body = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("aborted", "AbortError")),
            );
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    await expect(client.getTokenUsage("sk-1")).rejects.toMatchObject({
      status: 503,
      message: "new-api 不可达",
    });
  });

  it("uses one sk token for usage, logs, and image relay", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test/",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/api/usage/token/")) {
          return jsonResponse({
            code: true,
            message: "ok",
            data: { user_quota: 123456 },
          });
        }
        if (url.endsWith("/api/log/token")) {
          return jsonResponse({
            success: true,
            message: "",
            data: [{ quota: 42, model_name: "image-model" }],
          });
        }
        return jsonResponse({ data: [{ url: "https://cdn.test/image.png" }] });
      },
    });

    const usage = await client.getTokenUsage("sk-login");
    const logs = await client.getTokenLogs("sk-login");
    const images = await client.generateImages("sk-login", {
      model: "image-model",
      prompt: "a whale",
      n: 1,
    });

    expect(usage.userQuota).toBe(123456);
    expect(logs[0]?.quota).toBe(42);
    expect(images).toEqual([{ url: "https://cdn.test/image.png" }]);
    expect(requests[2]?.url).toBe("http://new-api.test/v1/images/generations");
    expect(
      requests.every(
        ({ init }) =>
          new Headers(init.headers).get("Authorization") === "Bearer sk-login",
      ),
    ).toBe(true);
    expect(JSON.parse(String(requests[2]?.init.body))).toMatchObject({
      model: "image-model",
      prompt: "a whale",
      n: 1,
      response_format: "url",
      stream: false,
    });
  });

  it("raises a typed error for an HTTP or business failure", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async () =>
        jsonResponse({ success: false, message: "余额不足" }, 402),
    });

    await expect(
      client.generateImages("sk-test", { model: "m", prompt: "p", n: 1 }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NewApiError>>({
        status: 402,
        message: "余额不足",
      }),
    );
  });
});
