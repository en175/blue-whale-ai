import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

import {
  InvalidCredentialsError,
  PasswordPolicyError,
} from "@lib/shared/identity/index.js";
import { MeController } from "./me.controller.js";

// IKBRCK：PUT /me/password 改密端点的入口校验 + 本地改密 + 账号域错误映射单测。
// 关键回归：原密码与口令策略都由**我们自己的库**判定（identity_users.password），
// 不再拿会话里那把项目级统一 key 去代打网关；错误对外仍是账号域数值码 + 中文。
// 改密成功后应吊销该用户全部会话（best-effort，失败不阻断改密）。

function createController(overrides: {
  changePassword?: ReturnType<typeof vi.fn>;
  revokeAllForUser?: ReturnType<typeof vi.fn>;
  revoke?: ReturnType<typeof vi.fn>;
  resolveTier?: ReturnType<typeof vi.fn>;
  listRoleCodes?: ReturnType<typeof vi.fn>;
  isAdmin?: ReturnType<typeof vi.fn>;
} = {}) {
  const sessions = {
    revokeAllForUser: overrides.revokeAllForUser ?? vi.fn().mockResolvedValue(0),
    revoke: overrides.revoke ?? vi.fn().mockResolvedValue(undefined),
  };
  const identity = {
    changePassword:
      overrides.changePassword ?? vi.fn().mockResolvedValue(undefined),
    resolveTier: overrides.resolveTier ?? vi.fn().mockResolvedValue("free"),
    listRoleCodes: overrides.listRoleCodes ?? vi.fn().mockResolvedValue([]),
    isAdmin: overrides.isAdmin ?? vi.fn().mockResolvedValue(false),
  };
  const controller = new MeController(sessions as never, identity as never);
  return { controller, sessions, identity };
}

const USER = { userId: "42", username: "alice" } as never;
/** 模拟 req：兜底吊销要的是**会话 cookie 里的 sess_ 令牌**，不是请求头上的上游 sk-。 */
const REQ = { cookies: { bw_session: "sess_current" } } as unknown as Request;
/** 模拟 res：记录 clearCookie 调用（passthrough 响应，控制器不发送）。 */
const RES = { clearCookie: vi.fn() } as unknown as Response;

const BODY = { original_password: "OldPass123", password: "NewPass456" };

describe("MeController（IKBRCK 改密）", () => {
  it("解析不到本地登录身份就 401，不改密", async () => {
    const { controller, identity } = createController();
    await expect(
      controller.changePassword(BODY, undefined, REQ, RES),
    ).rejects.toMatchObject({ status: 401 });
    expect(identity.changePassword).not.toHaveBeenCalled();
  });

  it("原密码或新密码缺失/为空就 400，不改密", async () => {
    const { controller, identity } = createController();
    for (const body of [
      { original_password: "", password: "NewPass456" },
      { original_password: "  ", password: "NewPass456" },
      { original_password: "OldPass123", password: "" },
      {},
      { original_password: "OldPass123" },
      { password: "NewPass456" },
    ]) {
      await expect(
        controller.changePassword(body, USER, REQ, RES),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(identity.changePassword).not.toHaveBeenCalled();
  });

  it("未知字段被契约 .strict() 拒绝（400），防止网关多用途接口被意外带参", async () => {
    const { controller, identity } = createController();
    await expect(
      controller.changePassword(
        {
          original_password: "OldPass123",
          password: "NewPass456",
          username: "hacked",
        },
        USER,
        REQ,
        RES,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(identity.changePassword).not.toHaveBeenCalled();
  });

  it("合法入参：按本地 userId 改密（原密码 + 新密码），成功后吊销全部会话", async () => {
    const { controller, identity, sessions } = createController({
      revokeAllForUser: vi.fn().mockResolvedValue(3),
    });
    const result = await controller.changePassword(BODY, USER, REQ, RES);
    expect(result).toMatchObject({ code: 200, data: { revokedSessions: 3 } });
    expect(identity.changePassword).toHaveBeenCalledWith("42", {
      oldPassword: "OldPass123",
      newPassword: "NewPass456",
    });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42);
    // 枚举吊销成功路径：不触发兜底单删
    expect(sessions.revoke).not.toHaveBeenCalled();
  });

  it("改密成功后会话吊销失败为 best-effort：仍返回 success，并兜底吊销当前会话+清 cookie", async () => {
    const { controller, sessions } = createController({
      revokeAllForUser: vi.fn().mockRejectedValue(new Error("redis timeout")),
    });
    const result = await controller.changePassword(BODY, USER, REQ, RES);
    expect(result).toMatchObject({ code: 200, data: { revokedSessions: 0 } });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42);
    // 兜底：直接吊销当前会话 + 清 cookie，保证当前浏览器改密后立即要求重新登录
    expect(sessions.revoke).toHaveBeenCalledWith("sess_current");
    expect(RES.clearCookie).toHaveBeenCalled();
  });

  it("原密码错误（本地 InvalidCredentialsError）→ 账号域数值码 1101 + 中文，且不吊销会话", async () => {
    const { controller, sessions } = createController({
      changePassword: vi.fn().mockRejectedValue(new InvalidCredentialsError()),
    });
    const result = await controller.changePassword(BODY, USER, REQ, RES);
    // IKBQEE / ADR-0078：账号域错误统一投影——返回 {code:1101, msg:中文}
    expect(result).toMatchObject({
      code: 1101,
      msg: "原密码错误，请重试",
      data: null,
    });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("新口令超长（本地口令策略）→ 账号域数值码 1102，文案说我们自己的口径", async () => {
    const { controller } = createController({
      changePassword: vi.fn().mockRejectedValue(
        new PasswordPolicyError("密码过长（72 字节上限，一个汉字算 3 字节）"),
      ),
    });
    const result = await controller.changePassword(BODY, USER, REQ, RES);
    expect(result).toMatchObject({
      code: 1102,
      msg: "密码过长（72 字节上限，一个汉字算 3 字节）",
      data: null,
    });
  });

  it("无法归类的错误 → 兜底 1100 + 通用中文，不吊销会话", async () => {
    const { controller, sessions } = createController({
      changePassword: vi.fn().mockRejectedValue(new Error("db exploded")),
    });
    const result = await controller.changePassword(BODY, USER, REQ, RES);
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

  it("★ is_admin 来自 identity，不看会话里那个", async () => {
    // 会话里的 isAdmin 是登录那一刻由 role 折算的快照，冻结/降权只有当次复核才更新。
    // 所以这里必须现查我们自己的角色表。
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
