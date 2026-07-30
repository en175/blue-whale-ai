import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("POST /api/auth/login", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEW_API_BASE_URL;
  });

  it("proxies username/password to new-api and returns its sk token", async () => {
    process.env.NEW_API_BASE_URL = "http://new-api.test";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { id: 7, username: "alice", token: "sk-login" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://web.test/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "secret" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      code: 200,
      data: { access_token: "sk-login", user_id: 7, username: "alice" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://new-api.test/api/user/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("maps a business-level credential failure to HTTP 401", async () => {
    process.env.NEW_API_BASE_URL = "http://new-api.test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            message: "用户名或密码错误",
            data: null,
          }),
          { status: 200 },
        ),
      ),
    );

    const response = await POST(
      new Request("http://web.test/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "wrong" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 401,
      msg: "登录凭证无效",
      data: null,
    });
  });

  it("maps an unreachable account service to a safe 503 response", async () => {
    process.env.NEW_API_BASE_URL = "http://internal-new-api.test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    const response = await POST(
      new Request("http://web.test/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "secret" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      code: 503,
      msg: "账户服务暂不可用",
      data: null,
    });
    expect(JSON.stringify(body)).not.toContain("internal-new-api");
  });
});
