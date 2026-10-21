import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "./auth.guard.js";

function makeContext(cookieValue?: string) {
  const request = {
    headers: { authorization: undefined },
    cookies: cookieValue ? { bw_session: cookieValue } : {},
    user: undefined as unknown,
  };
  const cookie = vi.fn();
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ cookie }),
    }),
  };
  return { context, request, cookie };
}

function makeGuard(opts: {
  isPublic?: boolean;
  verifyToken?: (token: string) => Promise<unknown>;
  resolveSession?: (token: string) => Promise<unknown>;
  resolveAccessState?: () => Promise<unknown>;
  wasEvicted?: () => Promise<boolean>;
} = {}) {
  const reflector = {
    getAllAndOverride: () => opts.isPublic ?? false,
  };
  const sessions = {
    verifyToken:
      opts.verifyToken ??
      (async () => ({ userId: "8", jti: "jti-1", type: "access" })),
    resolveSession: opts.resolveSession ?? (async () => null),
    updateSessionIdentity: async () => undefined,
    wasEvicted: opts.wasEvicted ?? (async () => false),
  };
  const identity = {
    resolveAccessState:
      opts.resolveAccessState ?? (async () => ({ role: 1, status: 1 })),
  };
  return new AuthGuard(
    reflector as never,
    sessions as never,
    identity as never,
  );
}

const VALID_SESSION = {
  userId: 8,
  username: "alice",
  role: 10,
  status: 1,
  email: "alice@example.com",
  needsRecheck: false,
};

describe("AuthGuard（HttpOnly cookie 会话校验，ADR-0062 #19）", () => {
  it("public 路由放行且不改写请求头、不刷新 cookie", async () => {
    const guard = makeGuard({ isPublic: true });
    const { context, request, cookie } = makeContext();
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.headers.authorization).toBeUndefined();
    expect(cookie).not.toHaveBeenCalled();
  });

  it("无会话 cookie → 401", async () => {
    const guard = makeGuard();
    const { context } = makeContext();
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("合法会话 cookie → 填充 user、刷新 cookie", async () => {
    const guard = makeGuard({ resolveSession: async () => VALID_SESSION });
    const { context, request, cookie } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.headers.authorization).toBeUndefined();
    expect(request.user).toEqual({
      userId: "8",
      status: "enabled",
      isAdmin: true,
      username: "alice",
      email: "alice@example.com",
    });
    expect(cookie).toHaveBeenCalledWith(
      "bw_session",
      "sess_abc",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("会话不存在/过期（resolve 返回 null）→ 401 session_expired", async () => {
    const guard = makeGuard();
    const { context } = makeContext("sess_dead");
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 401,
      code: "session_expired",
    });
  });

  it("被第 4 个浏览器挤出 → 401 session_evicted（前端据此换文案）", async () => {
    const guard = makeGuard({ wasEvicted: async () => true });
    const { context } = makeContext("sess_evicted");
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 401,
      code: "session_evicted",
    });
  });

  it("账户停用（status ≠ 1）→ 403", async () => {
    const guard = makeGuard({
      resolveSession: async () => ({ ...VALID_SESSION, status: 0 }),
    });
    const { context } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("needsRecheck=true 时回源身份库复核并回写，冻结立即 403", async () => {
    const update = vi.fn();
    const reflector = { getAllAndOverride: () => false };
    const sessions = {
      verifyToken: async () => ({ userId: "8", jti: "jti-1", type: "access" }),
      resolveSession: async () => ({
        ...VALID_SESSION,
        status: 1,
        needsRecheck: true,
      }),
      updateSessionIdentity: update,
    };
    const identity = {
      resolveAccessState: async () => ({ role: 10, status: 0 }),
    };
    const guard = new AuthGuard(
      reflector as never,
      sessions as never,
      identity as never,
    );
    const { context } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 403,
    });
    expect(update).toHaveBeenCalledWith("sess_abc", { role: 10, status: 0 });
  });

  it("复核查的是会话里的 userId", async () => {
    const resolveAccessState = vi.fn(async () => ({ role: 1, status: 1 }));
    const guard = makeGuard({
      resolveSession: async () => ({ ...VALID_SESSION, needsRecheck: true }),
      resolveAccessState,
    });
    const { context } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(resolveAccessState).toHaveBeenCalledWith(8);
  });

  it("needsRecheck=true 但身份库不可达 → 沿用缓存身份放行", async () => {
    const guard = makeGuard({
      resolveSession: async () => ({ ...VALID_SESSION, needsRecheck: true }),
      resolveAccessState: async () => {
        throw new Error("db down");
      },
    });
    const { context } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });

  it("会话服务异常（DB/Redis 错误）→ 503", async () => {
    const guard = makeGuard({
      resolveSession: async () => {
        throw new Error("redis down");
      },
    });
    const { context } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("普通用户（role < 10）→ isAdmin=false", async () => {
    const guard = makeGuard({
      resolveSession: async () => ({ ...VALID_SESSION, role: 1 }),
    });
    const { context, request } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect((request.user as { isAdmin: boolean }).isAdmin).toBe(false);
  });
  it("★ 令牌验签不通过（篡改/过期）→ 401，且**不碰 Redis**", async () => {
    const resolveSession = vi.fn();
    const guard = makeGuard({
      verifyToken: async () => {
        throw new Error("invalid signature");
      },
      resolveSession,
    });
    const { context } = makeContext("sess_tampered");

    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 401,
    });
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("★ 请求头优先于 cookie（IKJAZL 迁移期双读）", async () => {
    const resolveSession = vi.fn(async (token: string) =>
      token === "header-token" ? VALID_SESSION : null,
    );
    const guard = makeGuard({ resolveSession });
    const { context, request, cookie } = makeContext("cookie-token");
    request.headers.authorization = "Bearer header-token";

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(resolveSession).toHaveBeenCalledWith("header-token");
    expect(cookie).toHaveBeenCalledWith(
      "bw_session",
      "header-token",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("请求头不是 Bearer 形态 → 回退读 cookie", async () => {
    const resolveSession = vi.fn(async () => VALID_SESSION);
    const guard = makeGuard({ resolveSession });
    const { context, request } = makeContext("cookie-token");
    request.headers.authorization = "Basic abc";

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(resolveSession).toHaveBeenCalledWith("cookie-token");
  });
});
