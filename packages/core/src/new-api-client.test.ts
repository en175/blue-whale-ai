// IK74V8：从 new-api-client.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import {describe, expect, it} from "vitest";

import {NewApiError, createNewApiClient} from "./new-api-client.js";
import {jsonResponse} from "./new-api-client.testlib.js";

describe("new-api client —— 账户与错误映射", () => {
  it("adapts the complete account contract through one client", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test/",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/api/status")) {
          return jsonResponse({
            success: true,
            data: {
              register_enabled: true,
              password_login_enabled: true,
              password_register_enabled: true,
              email_verification: true,
              github_oauth: true,
            },
          });
        }
        if (url.endsWith("/api/user/register")) {
          return jsonResponse({
            success: true,
            data: {
              user_id: 8,
              username: "new-user",
              email: "new@example.com",
              token: "sk-register",
            },
          });
        }
        if (url.endsWith("/api/token/identity")) {
          return jsonResponse({
            success: true,
            data: {
              user_id: 8,
              username: "new-user",
              email: "new@example.com",
              status: 1,
              role: 100,
            },
          });
        }
        return jsonResponse({ code: true, data: { user_quota: 99 } });
      },
    });

    await expect(client.getAccountCapabilities()).resolves.toEqual({
      passwordLogin: true,
      passwordRegister: true,
      emailVerification: true,
    });
    await expect(
      client.register({
        username: "new-user",
        password: "secret",
        email: "new@example.com",
        verificationCode: "123456",
      }),
    ).resolves.toEqual({
      token: "sk-register",
      userId: 8,
      username: "new-user",
      email: "new@example.com",
      role: 1,
      status: 1,
    });
    await expect(client.resolveTokenIdentity("sk-register")).resolves.toEqual({
      userId: 8,
      username: "new-user",
      email: "new@example.com",
      status: 1,
      role: 100,
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "http://new-api.test/api/status",
      "http://new-api.test/api/user/register",
      "http://new-api.test/api/token/identity",
    ]);
    expect(new Headers(requests[2]?.init.headers).get("Authorization")).toBe(
      "Bearer sk-register",
    );
  });

  it("normalizes network failure to 503 and malformed account data to 502", async () => {
    const unreachable = createNewApiClient({
      baseUrl: "http://internal-new-api.test",
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED http://internal-new-api.test");
      },
    });
    await expect(unreachable.getAccountCapabilities()).rejects.toMatchObject({
      status: 503,
      message: "new-api 不可达",
    });

    const malformed = createNewApiClient({
      baseUrl: "http://internal-new-api.test",
      fetchImpl: async () =>
        jsonResponse({
          success: true,
          data: { user_id: "not-a-number", token: "secret-without-prefix" },
        }),
    });
    await expect(
      malformed.register({ username: "alice", password: "secret" }),
    ).rejects.toMatchObject({
      status: 502,
      code: "invalid_register_response",
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

    await expect(client.getAccountCapabilities()).rejects.toMatchObject({
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

    await expect(client.getAccountCapabilities()).rejects.toMatchObject({
      status: 503,
      message: "new-api 不可达",
    });
  });

  it("rejects login responses without a stable user identity", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async () =>
        jsonResponse({
          success: true,
          data: { token: "sk-login", user_id: null, username: null },
        }),
    });

    await expect(
      client.login({ username: "alice", password: "secret" }),
    ).rejects.toMatchObject({
      status: 502,
      code: "invalid_login_response",
    });
  });

  it("uses one sk token for login, usage, logs, and image relay", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test/",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/api/user/login")) {
          return jsonResponse({
            success: true,
            message: "",
            data: { id: 7, username: "alice", token: "sk-login" },
          });
        }
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

    const login = await client.login({ username: "alice", password: "secret" });
    const usage = await client.getTokenUsage(login.token);
    const logs = await client.getTokenLogs(login.token);
    const images = await client.generateImages(login.token, {
      model: "image-model",
      prompt: "a whale",
      n: 1,
    });

    expect(login.token).toBe("sk-login");
    expect(login.userId).toBe(7);
    expect(login.username).toBe("alice");
    expect(usage.userQuota).toBe(123456);
    expect(logs[0]?.quota).toBe(42);
    expect(images).toEqual([{ url: "https://cdn.test/image.png" }]);
    expect(requests[3]?.url).toBe("http://new-api.test/v1/images/generations");
    expect(
      requests
        .slice(1)
        .every(
          ({ init }) =>
            new Headers(init.headers).get("Authorization") ===
            "Bearer sk-login",
        ),
    ).toBe(true);
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      username: "alice",
      password: "secret",
    });
    expect(JSON.parse(String(requests[3]?.init.body))).toMatchObject({
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
