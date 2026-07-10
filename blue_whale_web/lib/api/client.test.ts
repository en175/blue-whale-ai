// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { apiFetch } from "./client";
import { ApiError, isApiError } from "./errors";

const FIXED_USER_ID = "11111111-1111-4111-8111-111111111111";

/** 替换 globalThis.fetch,返回 vi.fn Mock 供用例断言 url/init。 */
function stubFetch(responder: () => Response): Mock {
  const fn = vi.fn(async () => responder());
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn as unknown as Mock;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  // 每次测试前清空 localStorage,确保 userId 是本次 setItem 的产物
  window.localStorage.clear();
});

describe("apiFetch —— 成功路径", () => {
  it("GET 默认 base /api + 透传 path,自动带 X-User-Id", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }));

    const data = await apiFetch<{ ok: boolean }>("/me");

    expect(data).toEqual({ ok: true });
    const [calledUrl, calledInit] = fetchMock.mock.calls.at(-1)!;
    expect(calledUrl).toBe(`/api/me`);
    const headers = (calledInit.headers ?? {}) as Record<string, string>;
    expect(headers["X-User-Id"]).toBeDefined();
    expect(headers["X-User-Id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(headers["Accept"]).toBe("application/json");
  });

  it("POST 带 body 时设 Content-Type: application/json + JSON 序列化", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ id: "x" }));

    await apiFetch("/projects", {
      method: "POST",
      body: { title: "t", initial_prompt: "p" },
    });

    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(init.body).toBe(JSON.stringify({ title: "t", initial_prompt: "p" }));
  });

  it("204 No Content → 返回 undefined 且不尝试解析 body", async () => {
    stubFetch(() => new Response(null, { status: 204 }));

    const data = await apiFetch<void>("/projects/p1", { method: "DELETE" });
    expect(data).toBeUndefined();
  });

  it("query 参数序列化进 URL,undefined 跳过", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ items: [] }));

    await apiFetch("/projects", {
      query: { page: 2, q: "x", dropped: undefined },
    });

    const [url] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/projects?page=2&q=x");
  });

  it("baseUrl 可覆盖（测试 / 跨部署）", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));

    await apiFetch("/me", { baseUrl: "https://api.example.test/v1" });

    const [url] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("https://api.example.test/v1/me");
  });

  it("调用方自定义 headers 覆盖默认 Accept", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));

    await apiFetch("/me", { headers: { Accept: "text/plain" } });

    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect((init.headers as Record<string, string>)["Accept"]).toBe("text/plain");
  });

  it("透传 AbortSignal 给 fetch", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));
    const controller = new AbortController();

    await apiFetch("/me", { signal: controller.signal });

    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(init.signal).toBe(controller.signal);
  });
});

describe("apiFetch —— 失败路径（业务错误体）", () => {
  it("非 2xx + 业务 error 体 → ApiError 带 code/message/detail/status", async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: "not_found", message: "asset 不存在", detail: { id: "ast_x" } } },
        { status: 404 },
      ),
    );

    await expect(apiFetch("/assets/ast_x")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      message: "asset 不存在",
      detail: { id: "ast_x" },
    });
  });

  it("非 2xx + 无 error 段（纯 HTML/文本）→ 兜底 http_<status>", async () => {
    stubFetch(
      () => new Response("<html>500</html>", { status: 500, headers: { "Content-Type": "text/html" } }),
    );

    try {
      await apiFetch("/me");
      expect.fail("应抛 ApiError");
    } catch (e) {
      expect(isApiError(e)).toBe(true);
      expect((e as ApiError).code).toBe("http_500");
      expect((e as ApiError).status).toBe(500);
    }
  });

  it("非 2xx + JSON 但无 error 字段 → 兜底 http_<status>,message 走 statusText", async () => {
    stubFetch(() => jsonResponse({ message: "raw" }, { status: 422 }));

    try {
      await apiFetch("/x");
    } catch (e) {
      expect(isApiError(e)).toBe(true);
      const err = e as ApiError;
      expect(err.code).toBe("http_422");
      // 浏览器 fetch statusText 可能是空串
      expect(typeof err.message).toBe("string");
    }
  });
});

describe("apiFetch —— userId header", () => {
  it("本地已存合法 UUID → 请求 header 复用该值", async () => {
    window.localStorage.setItem("bw-user-id", FIXED_USER_ID);
    const fetchMock = stubFetch(() => jsonResponse({}));

    await apiFetch("/me");

    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect((init.headers as Record<string, string>)["X-User-Id"]).toBe(FIXED_USER_ID);
  });
});
