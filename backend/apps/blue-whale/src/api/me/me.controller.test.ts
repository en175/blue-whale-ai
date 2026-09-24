import { NewApiError } from "@lib/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MeController } from "./me.controller.js";

// IKBRCK：PUT /me/password 改密端点的入口校验 + 透传 + 上游失败映射单测。
// 关键回归：AuthGuard 回注 sk- 令牌后，控制器必须自解析请求头 Bearer 并原样转给
// AccountService；原密码错误/账号未设密码这类网关业务失败要原样把 message 透出。
// 改密成功后应吊销该用户全部会话（best-effort，失败不阻断改密）。

function createController(overrides: {
  changePassword?: ReturnType<typeof vi.fn>;
  revokeAllForUser?: ReturnType<typeof vi.fn>;
  revoke?: ReturnType<typeof vi.fn>;
  resolveTier?: ReturnType<typeof vi.fn>;
  listRoleCodes?: ReturnType<typeof vi.fn>;
  isAdmin?: ReturnType<typeof vi.fn>;
} = {}) {
  const account = {
    changePassword:
      overrides.changePassword ?? vi.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    revokeAllForUser: overrides.revokeAllForUser ?? vi.fn().mockResolvedValue(0),
    revoke: overrides.revoke ?? vi.fn().mockResolvedValue(undefined),
  };
  const identity = {
    resolveTier: overrides.resolveTier ?? vi.fn().mockResolvedValue("free"),
    listRoleCodes: overrides.listRoleCodes ?? vi.fn().mockResolvedValue([]),
    isAdmin: overrides.isAdmin ?? vi.fn().mockResolvedValue(false),
  };
  const controller = new MeController(
    account as never,
    sessions as never,
    identity as never,
  );
  return { controller, account, sessions, identity };
}

const USER = { userId: "42", username: "alice" } as never;
const BEARER = "Bearer sk-user-token";
/** 模拟 res：记录 clearCookie 调用（passthrough 响应，控制器不发送）。 */
const RES = {
  clearCookie: vi.fn(),
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MeController（IKBRCK 改密）", () => {
  it("没有 Bearer 令牌就 401，不调上游", async () => {
    const { controller, account } = createController();
    await expect(
      controller.changePassword(
        { original_password: "OldPass123", password: "NewPass456" },
        undefined,
        USER,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(account.changePassword).not.toHaveBeenCalled();
  });

  it("原密码或新密码缺失/为空就 400，不调上游", async () => {
    const { controller, account } = createController();
    for (const body of [
      { original_password: "", password: "NewPass456" },
      { original_password: "  ", password: "NewPass456" },
      { original_password: "OldPass123", password: "" },
      {},
      { original_password: "OldPass123" },
      { password: "NewPass456" },
    ]) {
      await expect(
        controller.changePassword(body, BEARER, USER),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(account.changePassword).not.toHaveBeenCalled();
  });

  it("未知字段被契约 .strict() 拒绝（400），防止网关多用途接口被意外带参", async () => {
    const { controller, account } = createController();
    await expect(
      controller.changePassword(
        {
          original_password: "OldPass123",
          password: "NewPass456",
          username: "hacked",
        },
        BEARER,
        USER,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(account.changePassword).not.toHaveBeenCalled();
  });

  it("合法入参：解析 Bearer 令牌并把 original_password/password 原样转给 AccountService，改密成功吊销全部会话", async () => {
    const { controller, account, sessions } = createController({
      revokeAllForUser: vi.fn().mockResolvedValue(3),
    });
    const result = await controller.changePassword(
      { original_password: "OldPass123", password: "NewPass456" },
      BEARER,
      USER,
      RES,
    );
    expect(result).toMatchObject({ code: 200, data: { revokedSessions: 3 } });
    expect(account.changePassword).toHaveBeenCalledWith(
      { originalPassword: "OldPass123", newPassword: "NewPass456" },
      "sk-user-token",
    );
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42);
    // 枚举吊销成功路径：不触发兜底单删
    expect(sessions.revoke).not.toHaveBeenCalled();
  });

  it("改密成功后会话吊销失败为 best-effort：仍返回 success，revokedSessions=0，并兜底吊销当前会话+清 cookie", async () => {
    const { controller, sessions } = createController({
      revokeAllForUser: vi.fn().mockRejectedValue(new Error("redis timeout")),
    });
    const result = await controller.changePassword(
      { original_password: "OldPass123", password: "NewPass456" },
      BEARER,
      USER,
      RES,
      RES,
    );
    expect(result).toMatchObject({ code: 200, data: { revokedSessions: 0 } });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42);
    // 兜底：直接吊销当前会话 + 清 cookie，保证当前浏览器改密后立即要求重新登录
    expect(sessions.revoke).toHaveBeenCalledWith("sk-user-token");
    expect(RES.clearCookie).toHaveBeenCalled();
  });

  it("没有 CurrentUser 时不吊销会话（仅改密），不抛错", async () => {
    const { controller, sessions } = createController();
    const result = await controller.changePassword(
      { original_password: "OldPass123", password: "NewPass456" },
      BEARER,
      undefined,
      RES,
    );
    expect(result).toMatchObject({ code: 200, data: { revokedSessions: 0 } });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("网关原密码错误（英文）→ 账号域数值码 1101 + 中文，且不吊销会话", async () => {
    const { controller, sessions } = createController({
      changePassword: vi.fn().mockRejectedValue(
        new NewApiError("Original password is incorrect", 400),
      ),
    });
    const result = await controller.changePassword(
      { original_password: "wrong", password: "NewPass456" },
      BEARER,
      USER,
      RES,
    );
    // IKBQEE / ADR-0078：账号域错误统一投影——不再透传英文，返回 {code:1101, msg:中文}
    expect(result).toMatchObject({
      code: 1101,
      msg: "原密码错误，请重试",
      data: null,
    });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("网关密码格式错误（英文 Invalid input）→ 账号域数值码 1102 + 中文", async () => {
    const { controller } = createController({
      changePassword: vi.fn().mockRejectedValue(
        new NewApiError("Invalid input", 200),
      ),
    });
    const result = await controller.changePassword(
      { original_password: "OldPass123", password: "123" },
      BEARER,
      USER,
      RES,
    );
    expect(result).toMatchObject({
      code: 1102,
      msg: "新密码需为 8-20 位",
      data: null,
    });
  });

  it("网关账号未设密码 → 账号域数值码 1103 + 中文", async () => {
    const { controller } = createController({
      changePassword: vi.fn().mockRejectedValue(
        new NewApiError("当前账号未设置密码", 200),
      ),
    });
    const result = await controller.changePassword(
      { original_password: "OldPass123", password: "NewPass456" },
      BEARER,
      USER,
      RES,
    );
    expect(result).toMatchObject({
      code: 1103,
      msg: "当前账号未设置密码",
      data: null,
    });
  });

  it("无法归类的网关错误 → 兜底 1100 + 通用中文，不吊销会话", async () => {
    const { controller, sessions } = createController({
      changePassword: vi.fn().mockRejectedValue(
        new NewApiError("upstream exploded", 500),
      ),
    });
    const result = await controller.changePassword(
      { original_password: "OldPass123", password: "NewPass456" },
      BEARER,
      USER,
      RES,
    );
    expect(result).toMatchObject({
      code: 1100,
      msg: "修改密码失败",
      data: null,
    });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});

describe("MeController（GET /me 会员等级）", () => {
  it("返回会员等级，且每次都现查", async () => {
    const resolveTier = vi.fn().mockResolvedValue("pro");
    const { controller } = createController({ resolveTier });

    const result = await controller.me(USER);

    expect(result).toMatchObject({ data: { tier: "pro" } });
    expect(resolveTier).toHaveBeenCalledWith("42");
  });

  it("无会员时是 free", async () => {
    const { controller } = createController();
    const result = await controller.me(USER);
    expect(result).toMatchObject({ data: { tier: "free" } });
  });

  it("等级来自 identity 而不是会话快照", async () => {
    // 会话里没有 tier 字段可读；这条断言钉住「等级不是从 user 对象拿的」——
    // 会员到期没有「用户重新登录」这一步，缓存在会话里会一直停在登录那一刻。
    const resolveTier = vi.fn().mockResolvedValue("max");
    const { controller } = createController({ resolveTier });

    await controller.me({ userId: "42", username: "alice", tier: "free" } as never);

    expect(resolveTier).toHaveBeenCalled();
    const result = await controller.me({ userId: "42", username: "alice" } as never);
    expect(result).toMatchObject({ data: { tier: "max" } });
  });

  it("★ is_admin 来自 identity，不看会话里那个（它源头是 new-api）", async () => {
    // 会话里的 isAdmin 来自 `session.role >= 10`，而 role 是 new-api 给的。
    // new-api 独立后这个字段会消失（`undefined >= 10` = false），
    // 那一刻**所有管理员的前端入口会静默消失**。所以这里必须现查我们自己的角色表。
    const isAdmin = vi.fn().mockResolvedValue(true);
    const { controller } = createController({ isAdmin });

    const result = await controller.me({
      userId: "42",
      username: "alice",
      isAdmin: false, // 会话说不是
    } as never);

    expect(result).toMatchObject({ data: { is_admin: true } }); // 角色表说了算
    expect(isAdmin).toHaveBeenCalledWith("42");
  });

  it("角色表说不是管理员，会话说是也不算", async () => {
    const isAdmin = vi.fn().mockResolvedValue(false);
    const { controller } = createController({ isAdmin });

    const result = await controller.me({
      userId: "42",
      username: "alice",
      isAdmin: true, // 陈旧的会话快照
    } as never);

    expect(result).toMatchObject({ data: { is_admin: false } });
  });
});
