import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

import { FAILURE_CODE } from "@lib/contracts";
import {
  CodeExpiredError,
  CodeWrongError,
  InvalidCredentialsError,
  PasswordPolicyError,
  PhoneAlreadyBoundError,
  PhoneTakenError,
} from "@lib/shared/identity/index.js";
import { MeController } from "./me.controller.js";


function createController(overrides: {
  changePassword?: ReturnType<typeof vi.fn>;
  revokeAllForUser?: ReturnType<typeof vi.fn>;
  revoke?: ReturnType<typeof vi.fn>;
  resolveTier?: ReturnType<typeof vi.fn>;
  listRoleCodes?: ReturnType<typeof vi.fn>;
  isAdmin?: ReturnType<typeof vi.fn>;
  resolveAccountFlags?: ReturnType<typeof vi.fn>;
  bindPhone?: ReturnType<typeof vi.fn>;
} = {}) {
  const sessions = {
    revokeAllForUser: overrides.revokeAllForUser ?? vi.fn().mockResolvedValue(0),
    revoke: overrides.revoke ?? vi.fn().mockResolvedValue(undefined),
  };
  const identity = {
    changePassword: overrides.changePassword ?? vi.fn().mockResolvedValue(false),
    resolveTier: overrides.resolveTier ?? vi.fn().mockResolvedValue("free"),
    listRoleCodes: overrides.listRoleCodes ?? vi.fn().mockResolvedValue([]),
    isAdmin: overrides.isAdmin ?? vi.fn().mockResolvedValue(false),
    resolveAccountFlags:
      overrides.resolveAccountFlags ??
      vi.fn().mockResolvedValue({
        phone: null,
        hasPassword: true,
        mustChangePassword: false,
      }),
    bindPhone: overrides.bindPhone ?? vi.fn().mockResolvedValue(undefined),
  };
  const controller = new MeController(sessions as never, identity as never);
  return { controller, sessions, identity };
}

const USER = { userId: "42", username: "alice" } as never;
const REQ = { loginToken: "sess_current" } as unknown as Request;
const RES = { clearCookie: vi.fn() } as unknown as Response;

const BODY = { original_password: "OldPass123", password: "NewPass456" };

beforeEach(() => {
  RES.clearCookie.mockClear();
});

describe("MeController（IKBRCK 改密）", () => {
  it("解析不到本地登录身份就 401，不改密", async () => {
    const { controller, identity } = createController();
    await expect(
      controller.changePassword(BODY, undefined, REQ, RES),
    ).rejects.toMatchObject({ status: 401 });
    expect(identity.changePassword).not.toHaveBeenCalled();
  });

  it("新密码缺失/为空就 400，不改密（原密码可缺——无口令账号走的是「设置密码」）", async () => {
    const { controller, identity } = createController();
    for (const body of [
      { original_password: "", password: "NewPass456" },
      { original_password: "  ", password: "NewPass456" },
      { original_password: "OldPass123", password: "" },
      {},
      { original_password: "OldPass123" },
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

  it("★ 无口令账号「设置密码」：不带原密码也能改（IKJA4R）", async () => {
    const { controller, identity } = createController();
    const result = await controller.changePassword(
      { password: "BrandNew456" },
      USER,
      REQ,
      RES,
    );
    expect(result).toMatchObject({ code: 200 });
    expect(identity.changePassword).toHaveBeenCalledWith("42", {
      oldPassword: undefined,
      newPassword: "BrandNew456",
    });
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
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42, undefined);
    expect(sessions.revoke).not.toHaveBeenCalled();
  });

  it("改密成功后会话吊销失败为 best-effort：仍返回 success，并兜底吊销当前会话+清 cookie", async () => {
    const { controller, sessions } = createController({
      revokeAllForUser: vi.fn().mockRejectedValue(new Error("redis timeout")),
    });
    const result = await controller.changePassword(BODY, USER, REQ, RES);
    expect(result).toMatchObject({ code: 200, data: { revokedSessions: 0 } });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42, undefined);
    expect(sessions.revoke).toHaveBeenCalledWith("sess_current");
    expect(RES.clearCookie).toHaveBeenCalled();
  });

  it("原密码错误（本地 InvalidCredentialsError）→ 账号域数值码 1101 + 中文，且不吊销会话", async () => {
    const { controller, sessions } = createController({
      changePassword: vi.fn().mockRejectedValue(new InvalidCredentialsError()),
    });
    const result = await controller.changePassword(BODY, USER, REQ, RES);
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

describe("MeController（IKJABH 强制改密不掉线）", () => {
  it("★ 强制改密：当前会话被豁免，其余会话照踢", async () => {
    const { controller, sessions } = createController({
      changePassword: vi.fn().mockResolvedValue(true),
      revokeAllForUser: vi.fn().mockResolvedValue(2),
    });

    const result = await controller.changePassword(BODY, USER, REQ, RES);

    expect(result).toMatchObject({ code: 200, data: { revokedSessions: 2 } });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42, "sess_current");
    expect(RES.clearCookie).not.toHaveBeenCalled();
  });

  it("★ 强制改密且枚举失败：兜底整个跳过，不能把刚豁免的会话又吊销掉", async () => {
    const { controller, sessions } = createController({
      changePassword: vi.fn().mockResolvedValue(true),
      revokeAllForUser: vi.fn().mockRejectedValue(new Error("redis timeout")),
    });

    const result = await controller.changePassword(BODY, USER, REQ, RES);

    expect(result).toMatchObject({ code: 200, data: { revokedSessions: 0 } });
    expect(sessions.revoke).not.toHaveBeenCalled();
    expect(RES.clearCookie).not.toHaveBeenCalled();
  });

  it("自助改密（非强制）行为不变：全部会话照旧吊销，含当前会话", async () => {
    const { controller, sessions } = createController({
      changePassword: vi.fn().mockResolvedValue(false),
      revokeAllForUser: vi.fn().mockResolvedValue(1),
    });

    await controller.changePassword(BODY, USER, REQ, RES);

    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42, undefined);
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
    const resolveTier = vi.fn().mockResolvedValue("max");
    const { controller } = createController({ resolveTier });

    await controller.me({ userId: "42", username: "alice", tier: "free" } as never);

    expect(resolveTier).toHaveBeenCalled();
    const result = await controller.me({ userId: "42", username: "alice" } as never);
    expect(result).toMatchObject({ data: { tier: "max" } });
  });

  it("★ is_admin 来自 identity，不看会话里那个", async () => {
    const isAdmin = vi.fn().mockResolvedValue(true);
    const { controller } = createController({ isAdmin });

    const result = await controller.me({
      userId: "42",
      username: "alice",
      isAdmin: false,
    } as never);

    expect(result).toMatchObject({ data: { is_admin: true } });
    expect(isAdmin).toHaveBeenCalledWith("42");
  });

  it("角色表说不是管理员，会话说是也不算", async () => {
    const isAdmin = vi.fn().mockResolvedValue(false);
    const { controller } = createController({ isAdmin });

    const result = await controller.me({
      userId: "42",
      username: "alice",
      isAdmin: true,
    } as never);

    expect(result).toMatchObject({ data: { is_admin: false } });
  });
});

describe("MeController（IKJA4Q 手机号与口令标识）", () => {
  it("phone / has_password 来自 identity 现查，不吃会话快照", async () => {
    const resolveAccountFlags = vi
      .fn()
      .mockResolvedValue({ phone: "13800001234", hasPassword: false });
    const { controller } = createController({ resolveAccountFlags });

    const result = await controller.me({
      userId: "42",
      username: "alice",
      phone: "19900000000",
    } as never);

    expect(result).toMatchObject({
      data: { phone: "13800001234", has_password: false, nickname: "alice" },
    });
    expect(resolveAccountFlags).toHaveBeenCalledWith("42");
  });

  it("有昵称时返回昵称，不再回退 username", async () => {
    const resolveAccountFlags = vi.fn().mockResolvedValue({
      phone: null,
      nickname: "蓝鲸用户_Ab12Cd",
      hasPassword: true,
    });
    const { controller } = createController({ resolveAccountFlags });

    const result = await controller.me({ userId: "42", username: "alice" } as never);

    expect(result).toMatchObject({ data: { nickname: "蓝鲸用户_Ab12Cd" } });
  });

  it("查不到人时回空串 + false——不替用户宣称他有口令", async () => {
    const { controller } = createController({
      resolveAccountFlags: vi.fn().mockResolvedValue(null),
    });

    const result = await controller.me({ userId: "42", username: "alice" } as never);

    expect(result).toMatchObject({ data: { phone: "", has_password: false } });
  });

  it("★ must_change_password 来自 identity 现查（IKJABH）", async () => {
    const resolveAccountFlags = vi
      .fn()
      .mockResolvedValue({ phone: null, hasPassword: true, mustChangePassword: true });
    const { controller } = createController({ resolveAccountFlags });

    const result = await controller.me({ userId: "42", username: "alice" } as never);

    expect(result).toMatchObject({ data: { must_change_password: true } });
    expect(resolveAccountFlags).toHaveBeenCalledWith("42");
  });

  it("查不到人时 must_change_password 回 false，不凭空拦人改密", async () => {
    const { controller } = createController({
      resolveAccountFlags: vi.fn().mockResolvedValue(null),
    });

    const result = await controller.me({ userId: "42", username: "alice" } as never);

    expect(result).toMatchObject({ data: { must_change_password: false } });
  });

  it("绑定手机号：合法入参转交 identity，返回成功信封", async () => {
    const bindPhone = vi.fn().mockResolvedValue(undefined);
    const { controller } = createController({ bindPhone });

    const result = await controller.bindPhone(
      { phone: "13800001234", code: "123456" },
      USER,
    );

    expect(result).toMatchObject({ code: 200 });
    expect(bindPhone).toHaveBeenCalledWith("42", {
      phone: "13800001234",
      code: "123456",
    });
  });

  it("绑定手机号：格式不对 / 验证码为空 → 失败信封，不碰 identity", async () => {
    const bindPhone = vi.fn();
    const { controller } = createController({ bindPhone });

    for (const body of [
      { phone: "12345", code: "123456" },
      { phone: "13800001234", code: "" },
      { phone: "", code: "123456" },
      {},
      { phone: 13800001234, code: "123456" },
    ]) {
      const result = await controller.bindPhone(body, USER);
      expect(result).toMatchObject({ code: FAILURE_CODE });
    }
    expect(bindPhone).not.toHaveBeenCalled();
  });

  it("绑定手机号：码错 / 被别人占用 / 自己已绑过 → 三句不同的话", async () => {
    const cases = [
      [new CodeWrongError(4), "验证码错误，请重新输入（还可尝试4次）"],
      [new CodeExpiredError(), "验证码已失效，请重新获取"],
      [new PhoneTakenError(), "该手机号已被绑定"],
      [new PhoneAlreadyBoundError(), "当前账号已绑定手机号，暂不支持换绑"],
    ] as const;

    for (const [error, msg] of cases) {
      const { controller } = createController({
        bindPhone: vi.fn().mockRejectedValue(error),
      });
      const result = await controller.bindPhone(
        { phone: "13800001234", code: "123456" },
        USER,
      );
      expect(result).toMatchObject({ code: FAILURE_CODE, msg, data: null });
    }
  });

  it("绑定手机号：没有登录身份就 401，不碰 identity", async () => {
    const bindPhone = vi.fn();
    const { controller } = createController({ bindPhone });

    await expect(
      controller.bindPhone({ phone: "13800001234", code: "123456" }, undefined),
    ).rejects.toMatchObject({ status: 401 });
    expect(bindPhone).not.toHaveBeenCalled();
  });
});
