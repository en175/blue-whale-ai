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
  resolveSession?: (token: string) => Promise<unknown>;
  resolveIdentity?: () => Promise<unknown>;
} = {}) {
  const reflector = {
    getAllAndOverride: () => opts.isPublic ?? false,
  };
  const sessions = {
    resolveSession: opts.resolveSession ?? (async () => null),
    updateSessionIdentity: async () => undefined,
  };
  const account = {
    resolveTokenIdentity: opts.resolveIdentity ?? (async () => ({ role: 1, status: 1 })),
  };
  return new AuthGuard(reflector as never, sessions as never, account as never);
}

const VALID_SESSION = {
  userId: 8,
  username: "alice",
  role: 10,
  status: 1,
  email: "alice@example.com",
  sk: "sk-real",
  needsRecheck: false,
};

describe("AuthGuard（HttpOnly cookie 会话校验 + 头回注，ADR-0062 #19）", () => {
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

  it("合法会话 cookie → 回注 sk-、填充 user、刷新 cookie", async () => {
    const guard = makeGuard({ resolveSession: async () => VALID_SESSION });
    const { context, request, cookie } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.headers.authorization).toBe("Bearer sk-real");
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

  it("会话不存在/过期（resolve 返回 null）→ 401", async () => {
    const guard = makeGuard();
    const { context } = makeContext("sess_dead");
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 401,
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

  it("needsRecheck=true 时回源 new-api 复核并回写，禁用立即 403", async () => {
    const update = vi.fn();
    const reflector = { getAllAndOverride: () => false };
    const sessions = {
      resolveSession: async () => ({
        ...VALID_SESSION,
        status: 1,
        needsRecheck: true,
      }),
      updateSessionIdentity: update,
    };
    const account = {
      // 上游已禁用该账户
      resolveTokenIdentity: async () => ({ role: 10, status: 0 }),
    };
    const guard = new AuthGuard(
      reflector as never,
      sessions as never,
      account as never,
    );
    const { context } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 403,
    });
    expect(update).toHaveBeenCalledWith("sess_abc", { role: 10, status: 0 });
  });

  it("needsRecheck=true 但上游不可达 → 沿用缓存身份放行", async () => {
    const guard = makeGuard({
      resolveSession: async () => ({ ...VALID_SESSION, needsRecheck: true }),
      resolveIdentity: async () => {
        throw new Error("upstream down");
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

  it("普通用户（role < 10）→ isAdmin=false，头照常回注", async () => {
    const guard = makeGuard({
      resolveSession: async () => ({ ...VALID_SESSION, role: 1 }),
    });
    const { context, request } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect((request.user as { isAdmin: boolean }).isAdmin).toBe(false);
    expect(request.headers.authorization).toBe("Bearer sk-real");
  });
});
