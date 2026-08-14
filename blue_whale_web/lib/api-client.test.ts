// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { apiFetch, apiRequest } from "./api-client";
import { ApiError, isApiError } from "./api/errors";

/** 替换 globalThis.fetch,每次调用经 responder 产出新 Response。 */
function stubFetch(responder: () => Response): Mock {
  const fn = vi.fn(async () => responder());
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn as unknown as Mock;
}

function jsonRes(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (init.headers) {
    new Headers(init.headers).forEach((v, k) => headers.set(k, v));
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("apiRequest —— GovernanceException envelope（IK2BCH）", () => {
  it("HTTP 400 + data.code=VALIDATION_FAILED + request_id → ApiError 保留 code/requestId/status", async () => {
    stubFetch(() =>
      jsonRes(
        {
          code: 100304,
          msg: "生成参数不在服务端能力范围内",
          data: {
            code: "VALIDATION_FAILED",
            message: "生成参数不在服务端能力范围内",
            request_id: "req_abc",
            retryable: false,
          },
        },
        { status: 400, headers: { "X-Request-Id": "req_abc" } },
      ),
    );

    await expect(
      apiRequest("/api/projects/1/generation-jobs", { method: "POST" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
      requestId: "req_abc",
      message: "生成参数不在服务端能力范围内",
    });

    // isApiError 窄化 + detail 装载完整 envelope
    try {
      await apiRequest("/api/projects/1/generation-jobs", { method: "POST" });
      expect.fail("应抛 ApiError");
    } catch (e) {
      expect(isApiError(e)).toBe(true);
      expect((e as ApiError).detail).toMatchObject({
        code: "VALIDATION_FAILED",
        request_id: "req_abc",
      });
    }
  });

  it("data 无 request_id 时从响应头 X-Request-Id 兜底", async () => {
    stubFetch(() =>
      jsonRes(
        {
          code: 100304,
          msg: "不支持的模型: x",
          data: { code: "VALIDATION_FAILED" },
        },
        { status: 400, headers: { "X-Request-Id": "req_from_header" } },
      ),
    );

    await expect(
      apiRequest("/api/x", { method: "POST" }),
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
      requestId: "req_from_header",
    });
  });

  it("非 JSON 错误响应 → 兜底 http_<status>,requestId 走响应头", async () => {
    stubFetch(
      () =>
        new Response("<html>502</html>", {
          status: 502,
          headers: { "Content-Type": "text/html", "X-Request-Id": "req_502" },
        }),
    );

    try {
      await apiRequest("/api/x");
      expect.fail("应抛 ApiError");
    } catch (e) {
      expect(isApiError(e)).toBe(true);
      const err = e as ApiError;
      expect(err.code).toBe("http_502");
      expect(err.status).toBe(502);
      expect(err.requestId).toBe("req_502");
    }
  });
});

describe("apiRequest —— HTTP 200 业务失败", () => {
  it("code !== 200 + data.code → ApiError 用 data.code", async () => {
    stubFetch(() =>
      jsonRes({
        code: 100304,
        msg: "业务拒绝",
        data: { code: "VALIDATION_FAILED", request_id: "req_200" },
      }),
    );

    await expect(apiRequest("/api/x")).rejects.toMatchObject({
      status: 200,
      code: "VALIDATION_FAILED",
      requestId: "req_200",
      message: "业务拒绝",
    });
  });

  it("code !== 200 + 无 data 段 → code 取 String(json.code)", async () => {
    stubFetch(() => jsonRes({ code: 500, msg: "boom" }));

    await expect(apiRequest("/api/x")).rejects.toMatchObject({
      status: 200,
      code: "500",
      message: "boom",
    });
  });
});

describe("apiRequest —— 成功 / 网络层", () => {
  it("code === 200 → 返回 data", async () => {
    stubFetch(() =>
      jsonRes({ code: 200, data: { generation_job_id: 42, cursor: 7 } }),
    );

    const data = await apiRequest<{
      generation_job_id: number;
      cursor: number;
    }>("/api/projects/1/generation-jobs", { method: "POST" });
    expect(data).toEqual({ generation_job_id: 42, cursor: 7 });
  });

  it("fetch 抛错（网络层）→ 普通 Error，非 ApiError，无 requestId", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    try {
      await apiRequest("/api/x");
      expect.fail("应抛 Error");
    } catch (e) {
      expect(isApiError(e)).toBe(false);
      expect((e as Error).message).toBe("后端未启动或无法连接");
    }
  });
});

describe("apiFetch —— new-api sk token 认证失败", () => {
  // IK8N1S：只有带用户会话失效标记（x-auth-failure: user-session）的 401
  // 才代表用户凭证失效；上游服务间鉴权失败不得触发登出。
  it("带标记的 401 → 清理登录态并通知订阅者", async () => {
    window.localStorage.setItem("bw-access-token", "sk-expired");
    const { subscribeToAuthFailure } = await import("./api-client");
    const onAuthFailure = vi.fn();
    const unsubscribe = subscribeToAuthFailure(onAuthFailure);
    stubFetch(() =>
      jsonRes(
        { code: 401, msg: "token 无效", data: null },
        { status: 401, headers: { "x-auth-failure": "user-session" } },
      ),
    );

    const response = await apiFetch("/api/projects");

    expect(response.status).toBe(401);
    expect(window.localStorage.getItem("bw-access-token")).toBeNull();
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("无标记的 401 → 按普通请求失败处理，不清 token、不通知登出", async () => {
    window.localStorage.setItem("bw-access-token", "sk-valid");
    const { subscribeToAuthFailure } = await import("./api-client");
    const onAuthFailure = vi.fn();
    const unsubscribe = subscribeToAuthFailure(onAuthFailure);
    const fetchMock = stubFetch(() =>
      jsonRes(
        { error: { code: "agent_upstream_unauthorized" } },
        { status: 401 },
      ),
    );

    const response = await apiFetch("/api/projects");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("bw-access-token")).toBe("sk-valid");
    expect(onAuthFailure).not.toHaveBeenCalled();
    unsubscribe();
  });
});
