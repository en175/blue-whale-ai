import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

import { InvalidVerificationCodeError } from "@lib/core";
import { FAILURE_CODE } from "@lib/contracts";
import {
  InvalidCredentialsError,
  PasswordPolicyError,
  PhoneAlreadyBoundError,
  PhoneTakenError,
} from "@lib/shared/identity/index.js";
import { MeController } from "./me.controller.js";

// IKBRCK：PUT /me/password 改密端点的入口校验 + 本地改密 + 账号域错误映射单测。
// 关键回归：原密码与口令策略都由**我们自己的库**判定（bw_users.password），
// 不再拿会话里那把项目级统一 key 去代打网关；错误对外仍是账号域数值码 + 中文。
// 改密成功后应吊销该用户全部会话（best-effort，失败不阻断改密）。

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
    // 返回「本次是不是强制改密」——IKJABH 加的那个返回值。**默认 false**：
    // 绝大多数改密是用户自助的，落回 undefined 会让下面每条断言的参数形态失真。
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
/**
 * 模拟 req：兜底吊销取的是 **AuthGuard 存下的 `loginToken`**（IKJAZM）。
 * 既不是 cookie（迁移期通道，迟早撤掉），也不是请求头（那一刻已被回注成上游 sk-）。
 */
const REQ = { loginToken: "sess_current" } as unknown as Request;
/** 模拟 res：记录 clearCookie 调用（passthrough 响应，控制器不发送）。 */
const RES = { clearCookie: vi.fn() } as unknown as Response;

const BODY = { original_password: "OldPass123", password: "NewPass456" };

// `RES` 是模块级的共享替身，调用记录会跨用例累积 —— 不清的话，
// 「不该清 cookie」这类否定断言会被上一个用例的调用误伤成假红。
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
    // 手机号验证码建号出来的账号没有口令。前端在那种情况下不渲染原密码框，
    // 请求体里就真的没有 original_password —— 契约必须允许，否则这一个分支永远走不通。
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
    // 第二个参数是「要留下的会话」——自助改密一个不留，所以是 undefined。
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42, undefined);
    // 枚举吊销成功路径：不触发兜底单删
    expect(sessions.revoke).not.toHaveBeenCalled();
  });

  it("改密成功后会话吊销失败为 best-effort：仍返回 success，并兜底吊销当前会话+清 cookie", async () => {
    const { controller, sessions } = createController({
      revokeAllForUser: vi.fn().mockRejectedValue(new Error("redis timeout")),
    });
    const result = await controller.changePassword(BODY, USER, REQ, RES);
    expect(result).toMatchObject({ code: 200, data: { revokedSessions: 0 } });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42, undefined);
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

// IKJABH 任务 5：**强制改密不能让用户掉线**。
//
// 被管理员重置过密码的用户，登录后的第一件事就是被拦去改密。如果改密这一步
// 顺手把他自己那条会话也吊销了，流程会变成「登进来 → 被拦 → 改完 → 立刻被踢回
// 登录页 → 再登一次」，改密完成得毫无反馈。所以那一次要留下当前会话。
describe("MeController（IKJABH 强制改密不掉线）", () => {
  it("★ 强制改密：当前会话被豁免，其余会话照踢", async () => {
    const { controller, sessions } = createController({
      changePassword: vi.fn().mockResolvedValue(true), // 进入时账号正被重置过
      revokeAllForUser: vi.fn().mockResolvedValue(2),
    });

    const result = await controller.changePassword(BODY, USER, REQ, RES);

    expect(result).toMatchObject({ code: 200, data: { revokedSessions: 2 } });
    // 当前令牌被排除在外，「已登出其他设备」照样统计
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42, "sess_current");
    // 豁免就不能顺手清 cookie —— 清了等于把当前浏览器登出
    expect(RES.clearCookie).not.toHaveBeenCalled();
  });

  it("★ 强制改密且枚举失败：兜底整个跳过，不能把刚豁免的会话又吊销掉", async () => {
    // 兜底的动作（吊销当前会话 + 清 cookie）正是上面刚豁免掉的那两件事。
    // 跑下去等于把豁免原地撤销 —— 用户还是掉线，只是换了个地方掉。
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
    // 豁免只属于强制改密。自助改密改完重新登录是合理的，本单不动它。
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

// IKJA4Q：手机号在 `bw_users` 上是**后加的、多数为 null** 的标识。这里钉住的是
// 「它是查出来的真值，不是写死的空串」——写死的版本对每个用户都成立，也就等于没有。
describe("MeController（IKJA4Q 手机号与口令标识）", () => {
  it("phone / has_password 来自 identity 现查，不吃会话快照", async () => {
    const resolveAccountFlags = vi
      .fn()
      .mockResolvedValue({ phone: "13800001234", hasPassword: false });
    const { controller } = createController({ resolveAccountFlags });

    const result = await controller.me({
      userId: "42",
      username: "alice",
      phone: "19900000000", // 陈旧的会话快照
    } as never);

    expect(result).toMatchObject({
      data: { phone: "13800001234", has_password: false },
    });
    expect(resolveAccountFlags).toHaveBeenCalledWith("42");
  });

  it("查不到人时回空串 + false——不替用户宣称他有口令", async () => {
    const { controller } = createController({
      resolveAccountFlags: vi.fn().mockResolvedValue(null),
    });

    const result = await controller.me({ userId: "42", username: "alice" } as never);

    expect(result).toMatchObject({ data: { phone: "", has_password: false } });
  });

  it("★ must_change_password 来自 identity 现查（IKJABH）", async () => {
    // 与 phone / has_password 同一条理由：用户改完密码之后，这个标记必须**立刻**
    // 变成 false；吃会话快照的话它会一直停在登录那一刻（也就是 true），
    // 用户改完密还会被反复拦去改密。
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
    // 三种失败给用户的下一步完全不同（重发码 / 找客服 / 知道自己是既有用户），
    // 合并成一句「绑定失败」等于把三条岔路都堵死。
    const cases = [
      [new InvalidVerificationCodeError("验证码错误或已过期"), "验证码错误或已过期"],
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
