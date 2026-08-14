// @vitest-environment jsdom
/**
 * canvas 请求层 401 恢复链路测试：
 * 带用户会话失效标记的 401 触发 notifyAuthFailure（清 token + 通知登录），
 * 与 api-client 同一出口；无标记的 401 是普通请求失败，不触发登出（IK8N1S）。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { listProjects, saveCanvas } from "./canvas";
import { subscribeToAuthFailure } from "./api-client";

function stubFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Mock {
  const fn = vi.fn(async () => {
    const merged = new Headers({
      "Content-Type": "application/json",
      ...headers,
    });
    return new Response(JSON.stringify(body), { status, headers: merged });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn as unknown as Mock;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("canvas 请求层 401 恢复链路", () => {
  it("条件保存携带当前 Canvas 版本", async () => {
    const fetchMock = stubFetch(200, {
      code: 200,
      msg: "",
      success: true,
      data: {
        id: "2",
        project_id: "1",
        version: 4,
        viewport: "{}",
        nodes: "[]",
      },
    });

    await saveCanvas("1", "{}", "[]", 3);

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(options.headers).get("If-Match")).toBe('"3"');
  });

  it("非 401 失败 → 不触发登录回调、不清 token", async () => {
    window.localStorage.setItem("bw-access-token", "sk-valid");
    stubFetch(500, { code: 500, msg: "boom", success: false, data: null });

    const handler = vi.fn();
    const unsubscribe = subscribeToAuthFailure(handler);
    try {
      await expect(listProjects()).rejects.toMatchObject({ code: 500 });
      expect(handler).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("bw-access-token")).toBe("sk-valid");
    } finally {
      unsubscribe();
    }
  });

  it("200 正常返回 data", async () => {
    stubFetch(200, {
      code: 200,
      msg: "",
      success: true,
      data: [{ id: 1, name: "p", thumb: null, created_at: "" }],
    });
    const projects = await listProjects();
    expect(projects).toHaveLength(1);
  });
});

describe("canvas 请求层 401 标记判定（IK8N1S）", () => {
  it("带标记的 401 → 清空 token + 触发登录回调", async () => {
    window.localStorage.setItem("bw-access-token", "sk-stale");
    stubFetch(
      401,
      { code: 401, msg: "Unauthorized", success: false, data: null },
      { "x-auth-failure": "user-session" },
    );

    const handler = vi.fn();
    const unsubscribe = subscribeToAuthFailure(handler);
    try {
      await expect(listProjects()).rejects.toMatchObject({ code: 401 });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem("bw-access-token")).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it("无标记的 401 → 不触发登录回调、不清 token", async () => {
    window.localStorage.setItem("bw-access-token", "sk-valid");
    stubFetch(401, {
      code: 401,
      msg: "Unauthorized",
      success: false,
      data: null,
    });

    const handler = vi.fn();
    const unsubscribe = subscribeToAuthFailure(handler);
    try {
      await expect(listProjects()).rejects.toMatchObject({ code: 401 });
      expect(handler).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("bw-access-token")).toBe("sk-valid");
    } finally {
      unsubscribe();
    }
  });
});
