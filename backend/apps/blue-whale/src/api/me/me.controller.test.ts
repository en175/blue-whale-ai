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
} = {}) {
  const account = {
    changePassword:
      overrides.changePassword ?? vi.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    revokeAllForUser: overrides.revokeAllForUser ?? vi.fn().mockResolvedValue(0),
    revoke: overrides.revoke ?? vi.fn().mockResolvedValue(undefined),
  };
  const controller = new MeController(account as never, sessions as never);
  return { controller, account, sessions };
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
