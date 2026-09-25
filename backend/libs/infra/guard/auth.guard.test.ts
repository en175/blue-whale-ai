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

/** 当前配置里的上游 key。守卫不再从会话取它，而是每次按配置取。 */
const CURRENT_KEY = "sk-current-upstream";

function makeGuard(opts: {
  isPublic?: boolean;
  resolveSession?: (token: string) => Promise<unknown>;
  resolveAccessState?: () => Promise<unknown>;
  requireUpstreamKey?: () => Promise<string>;
} = {}) {
  const reflector = {
    getAllAndOverride: () => opts.isPublic ?? false,
  };
  const sessions = {
    resolveSession: opts.resolveSession ?? (async () => null),
    updateSessionIdentity: async () => undefined,
  };
  const identity = {
    resolveAccessState:
      opts.resolveAccessState ?? (async () => ({ role: 1, status: 1 })),
  };
  const settings = {
    requireUpstreamKey: opts.requireUpstreamKey ?? (async () => CURRENT_KEY),
  };
  return new AuthGuard(
    reflector as never,
    sessions as never,
    identity as never,
    settings as never,
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

  it("合法会话 cookie → 回注**当前配置**的 key、填充 user、刷新 cookie", async () => {
    const guard = makeGuard({ resolveSession: async () => VALID_SESSION });
    const { context, request, cookie } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.headers.authorization).toBe(`Bearer ${CURRENT_KEY}`);
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

  it("needsRecheck=true 时回源身份库复核并回写，冻结立即 403", async () => {
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
    const identity = {
      // 库里该账号已被冻结
      resolveAccessState: async () => ({ role: 10, status: 0 }),
    };
    const guard = new AuthGuard(
      reflector as never,
      sessions as never,
      identity as never,
      { requireUpstreamKey: async () => CURRENT_KEY } as never,
    );
    const { context } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 403,
    });
    expect(update).toHaveBeenCalledWith("sess_abc", { role: 10, status: 0 });
  });

  it("复核查的是会话里的 userId（统一 key 不再代表任何一个人）", async () => {
    const resolveAccessState = vi.fn(async () => ({ role: 1, status: 1 }));
    const guard = makeGuard({
      resolveSession: async () => ({ ...VALID_SESSION, needsRecheck: true }),
      resolveAccessState,
    });
    const { context } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(resolveAccessState).toHaveBeenCalledWith(8);
    expect(resolveAccessState).not.toHaveBeenCalledWith(CURRENT_KEY);
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

  it("普通用户（role < 10）→ isAdmin=false，头照常回注", async () => {
    const guard = makeGuard({
      resolveSession: async () => ({ ...VALID_SESSION, role: 1 }),
    });
    const { context, request } = makeContext("sess_abc");
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect((request.user as { isAdmin: boolean }).isAdmin).toBe(false);
    expect(request.headers.authorization).toBe(`Bearer ${CURRENT_KEY}`);
  });
});

describe("AuthGuard 回注的上游 key 取**当前配置**（管理端改完即生效）", () => {
  it("★ 配置改了 → 下一次请求就是新值（会话里那份 7 天快照的老路已废）", async () => {
    // 老实现把 key 冻在会话里：管理端轮换之后，已在线的用户最长 7 天还在用旧 key。
    let current = "sk-before-rotation";
    const guard = makeGuard({
      resolveSession: async () => VALID_SESSION,
      requireUpstreamKey: async () => current,
    });

    const first = makeContext("sess_abc");
    await guard.canActivate(first.context as never);
    expect(first.request.headers.authorization).toBe("Bearer sk-before-rotation");

    current = "sk-after-rotation";
    const second = makeContext("sess_abc");
    await guard.canActivate(second.context as never);
    expect(second.request.headers.authorization).toBe("Bearer sk-after-rotation");
  });

  it("★ 没配 / 读不出来 → 不注入也不拦：否则新部署没人进得去管理端把它配上", async () => {
    // key 要在管理端填，管理端要走这个守卫。这里若直接 503，就是一条谁也解不开的死循环。
    // 缺失的 fail-closed 落在下游 `parseBearerToken` 拿到 null 时的 401
    // （见 material.service / text-completions.controller 等），空串到不了上游。
    const guard = makeGuard({
      resolveSession: async () => VALID_SESSION,
      requireUpstreamKey: async () => {
        throw new Error("上游凭证未配置");
      },
    });
    const { context, request, cookie } = makeContext("sess_abc");

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.headers.authorization).toBeUndefined();
    expect(cookie).toHaveBeenCalled();
    expect((request.user as { userId: string }).userId).toBe("8");
  });
});
