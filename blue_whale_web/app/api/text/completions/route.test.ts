import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveTokenIdentity: vi.fn(),
  listEnabledByType: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@blue-whale/core", () => ({
  createNewApiClient: () => ({
    resolveTokenIdentity: mocks.resolveTokenIdentity,
  }),
  NewApiError: class NewApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@blue-whale/persistence", () => ({
  createModelCapabilityRepo: () => ({
    listEnabledByType: mocks.listEnabledByType,
  }),
  getPrismaClient: () => ({}),
}));

import { POST } from "./route";

function postRequest(body: unknown, token = "sk-test") {
  return new Request("http://localhost/api/text/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * POST /api/text/completions —— OpenAI 兼容薄代理（IK6ZEH）。
 * 登录鉴权走账户层（resolveTokenIdentity）+ text 白名单闸，成功即 raw 透传 Go。
 */
describe("POST /api/text/completions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEW_API_BASE_URL", "http://go.test");
    vi.stubEnv("DATABASE_URL", "postgres://test");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.resolveTokenIdentity.mockResolvedValue({
      userId: 1,
      username: "user1",
      email: null,
      status: 1,
    });
    mocks.listEnabledByType.mockResolvedValue([{ model_id: "MiniMax-M3" }]);
  });

  it("503: NEW_API_BASE_URL 未配置 → OpenAI 错误形状", async () => {
    vi.stubEnv("NEW_API_BASE_URL", "");
    const response = await POST(
      postRequest({ model: "MiniMax-M3", messages: [] }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { type: "server_error", code: "config_missing" },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("401: 缺/无效 sk- 令牌 → 鉴权 envelope（withAuthenticatedUser 先拦）", async () => {
    const response = await POST(
      postRequest({ model: "MiniMax-M3", messages: [] }, ""),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: 401,
      msg: "登录凭证无效",
      data: null,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("400: model 不在白名单 → invalid_request_error", async () => {
    const response = await POST(postRequest({ model: "gpt-4", messages: [] }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { type: "invalid_request_error", code: "model_not_in_whitelist" },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("非流式: 透传 Go JSON 响应 + sk 令牌", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cmpl-1",
          object: "chat.completion",
          choices: [
            {
              message: { role: "assistant", content: "你好，蓝鲸" },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const response = await POST(
      postRequest({
        model: "MiniMax-M3",
        messages: [{ role: "user", content: "你好" }],
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toMatchObject({
      object: "chat.completion",
      choices: [{ message: { content: "你好，蓝鲸" } }],
    });

    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://go.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer sk-test",
        }),
        body: JSON.stringify({
          model: "MiniMax-M3",
          messages: [{ role: "user", content: "你好" }],
        }),
      }),
    );
  });

  it("流式: raw SSE 透传（content-type + 分块文本原样）", async () => {
    const sse =
      'data: {"id":"cmpl-1","choices":[{"delta":{"content":"你"}}]}\n\ndata: [DONE]\n\n';
    mocks.fetch.mockResolvedValue(
      new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const response = await POST(
      postRequest({ model: "MiniMax-M3", messages: [], stream: true }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe(sse);
  });

  it("Go 4xx（如 402 quota）透传 OpenAI 错误体与状态", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "余额不足",
            type: "insufficient_quota",
            code: "quota_exhausted",
          },
        }),
        {
          status: 402,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const response = await POST(
      postRequest({ model: "MiniMax-M3", messages: [] }),
    );
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "quota_exhausted" },
    });
  });
});
