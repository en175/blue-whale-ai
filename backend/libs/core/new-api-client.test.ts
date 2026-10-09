import {describe, expect, it} from "vitest";

import {
  NewApiError,
  CLIENT_SYSTEM_BLUEWHALE,
  createNewApiClient,
} from "./new-api-client.js";
import {createNewApiRequest} from "./new-api-transport.js";
import {jsonResponse} from "./new-api-client.testlib.js";

const IMAGE = { model: "m", prompt: "p", n: 1 };

describe("new-api client —— 传输层与错误映射", () => {
  it("declares the bluewhale client system on every outbound request", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test/",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/api/pricing")) {
          return jsonResponse({ success: true, data: [] });
        }
        return jsonResponse({ data: [{ url: "https://cdn.test/image.png" }] });
      },
    });

    await client.getPricing();
    await client.generateImages("sk-1", IMAGE);

    expect(requests).toHaveLength(2);
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

  it("normalizes network failure to 503", async () => {
    const unreachable = createNewApiClient({
      baseUrl: "http://internal-new-api.test",
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED http://internal-new-api.test");
      },
    });
    await expect(unreachable.generateImages("sk-1", IMAGE)).rejects.toMatchObject({
      status: 503,
      message: "new-api 不可达",
    });
  });

  it("aborts requests at the configured timeout and reports 503", async () => {
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

    await expect(client.generateImages("sk-1", IMAGE)).rejects.toMatchObject({
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

    await expect(client.generateImages("sk-1", IMAGE)).rejects.toMatchObject({
      status: 503,
      message: "new-api 不可达",
    });
  });

  it("uses one sk token for image relay", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test/",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        return jsonResponse({ data: [{ url: "https://cdn.test/image.png" }] });
      },
    });

    const images = await client.generateImages("sk-login", {
      model: "image-model",
      prompt: "a whale",
      n: 1,
    });

    expect(images).toEqual([{ url: "https://cdn.test/image.png" }]);
    expect(requests[0]?.url).toBe("http://new-api.test/v1/images/generations");
    expect(new Headers(requests[0]?.init.headers).get("Authorization")).toBe(
      "Bearer sk-login",
    );
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
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
      client.generateImages("sk-test", IMAGE),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NewApiError>>({
        status: 402,
        message: "余额不足",
      }),
    );
  });
});
