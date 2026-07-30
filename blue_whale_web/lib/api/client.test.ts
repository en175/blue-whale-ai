// @vitest-environment jsdom
import { describe, it, expect, vi, type Mock } from "vitest";
import * as api from "./index";
import { apiFetch } from "./client";
import { ApiError, isApiError } from "./errors";

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

describe("apiFetch —— 成功路径", () => {
  it("GET 默认 base /api + 透传 path,不带 X-User-Id", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }));

    const data = await apiFetch<{ ok: boolean }>("/me");

    expect(data).toEqual({ ok: true });
    const [calledUrl, calledInit] = fetchMock.mock.calls.at(-1)!;
    expect(calledUrl).toBe(`/api/me`);
    const headers = (calledInit.headers ?? {}) as Record<string, string>;
    expect(headers["X-User-Id"]).toBeUndefined();
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
    expect((init.headers as Record<string, string>)["Accept"]).toBe(
      "text/plain",
    );
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
        {
          error: {
            code: "not_found",
            message: "asset 不存在",
            detail: { id: "ast_x" },
          },
        },
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
      () =>
        new Response("<html>500</html>", {
          status: 500,
          headers: { "Content-Type": "text/html" },
        }),
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

describe("apiFetch —— X-User-Id header", () => {
  it("移除调用方传入的大小写变体,其余 headers 保持", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));

    await apiFetch("/me", {
      headers: {
        "x-user-id": "spoofed-lowercase",
        "X-USER-ID": "spoofed-uppercase",
        "X-Trace-Id": "trace-123",
      },
    });

    const [, init] = fetchMock.mock.calls.at(-1)!;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-User-Id"]).toBeUndefined();
    expect(
      Object.keys(headers).some((key) => key.toLowerCase() === "x-user-id"),
    ).toBe(false);
    expect(headers["X-Trace-Id"]).toBe("trace-123");
  });
});

describe("api public barrel", () => {
  it("does not export getOrCreateUserId", () => {
    expect("getOrCreateUserId" in api).toBe(false);
  });
});
