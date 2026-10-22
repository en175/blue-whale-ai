import { beforeEach, describe, expect, it, vi } from "vitest";

const { grantCredits } = vi.hoisted(() => ({ grantCredits: vi.fn() }));

vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/shared/billing/billing-admin-client.js")>();
  return { ...actual, grantCredits };
});

import {
  BillingAdminConfigError,
  BillingAdminError,
} from "@lib/shared/billing/billing-admin-client.js";
import { PasswordPolicyError } from "@lib/shared/identity/index.js";
import { AdminUsersController } from "./users.controller.js";


function createController(overrides: {
  setUserStatus?: ReturnType<typeof vi.fn>;
  revokeAllForUser?: ReturnType<typeof vi.fn>;
  operationLogCreate?: ReturnType<typeof vi.fn>;
  userExists?: ReturnType<typeof vi.fn>;
  listAdminUsers?: ReturnType<typeof vi.fn>;
  listRoleCodes?: ReturnType<typeof vi.fn>;
  resetPassword?: ReturnType<typeof vi.fn>;
} = {}) {
  const operationLog = { create: overrides.operationLogCreate ?? vi.fn().mockResolvedValue(undefined) };
  const sessions = { revokeAllForUser: overrides.revokeAllForUser ?? vi.fn().mockResolvedValue(0) };
  const identity = {
    listAdminUsers: overrides.listAdminUsers ?? vi.fn().mockResolvedValue({ items: [], total: 0 }),
    setUserStatus: overrides.setUserStatus ?? vi.fn().mockResolvedValue(true),
    userExists: overrides.userExists ?? vi.fn().mockResolvedValue(true),
    listRoleCodes: overrides.listRoleCodes ?? vi.fn().mockResolvedValue([]),
    resetPassword: overrides.resetPassword ?? vi.fn().mockResolvedValue(undefined),
  };
  const controller = new AdminUsersController(
    identity as never,
    identity as never,
    operationLog as never,
    sessions as never,
  );
  return { controller, identity, operationLog, sessions };
}

const USER = { userId: "1", username: "admin" } as never;
const ADMIN_CTX = {
  user: USER,
  rawUserId: "42",
  body: { action: "freeze", reason: "违规" },
};

describe("AdminUsersController.manage（冻结强制登出）", () => {
  beforeEach(() => {
    grantCredits.mockReset();
  });

  it("freeze：先本地置 DISABLED，再踢该用户全部会话，返回吊销数", async () => {
    const { controller, identity, sessions } = createController({
      revokeAllForUser: vi.fn().mockResolvedValue(3),
    });
    const order: string[] = [];
    identity.setUserStatus.mockImplementation(async () => {
      order.push("disable");
      return true;
    });
    sessions.revokeAllForUser.mockImplementation(async () => {
      order.push("revoke");
      return 3;
    });

    const result = await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      ADMIN_CTX.body,
    );

    expect(result).toEqual({ success: true, data: { revokedSessions: 3 } });
    expect(order).toEqual(["disable", "revoke"]);
    expect(identity.setUserStatus).toHaveBeenCalledWith(42, "DISABLED");
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42);
  });

  it("freeze：审计 detail 记录 revokedSessions", async () => {
    const { controller, operationLog } = createController({
      revokeAllForUser: vi.fn().mockResolvedValue(2),
    });
    await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      ADMIN_CTX.body,
    );
    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "user",
        action: "user.freeze",
        target: "user:42",
        targetUserId: "42",
        detail: expect.stringContaining('"revokedSessions":2'),
      }),
    );
  });

  it("freeze：会话踢出失败为 best-effort，仍返回 success，审计记 revokeError", async () => {
    const { controller, operationLog } = createController({
      revokeAllForUser: vi
        .fn()
        .mockRejectedValue(new Error("redis timeout")),
    });
    const result = await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      ADMIN_CTX.body,
    );
    expect(result).toEqual({ success: true, data: { revokedSessions: 0 } });
    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('"revokeError":"redis timeout"'),
      }),
    );
  });

  it("freeze：写状态失败则不踢会话、整体失败", async () => {
    const { controller, sessions } = createController({
      setUserStatus: vi.fn().mockRejectedValue(new Error("db down")),
    });
    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        ADMIN_CTX.body,
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("freeze：用户不存在 → 404，不静默成功", async () => {
    const { controller, sessions } = createController({
      setUserStatus: vi.fn().mockResolvedValue(false),
    });
    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        ADMIN_CTX.body,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("unfreeze：把状态置回 NORMAL，不调 revokeAllForUser，响应 data 为 null", async () => {
    const { controller, identity, sessions } = createController();
    const result = await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      { action: "unfreeze", reason: "已改正" },
    );
    expect(result).toEqual({ success: true, data: null });
    expect(identity.setUserStatus).toHaveBeenCalledWith(42, "NORMAL");
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("adjustBalance：调 billing 发放（source=gift / bizType=grant），幂等键取 Idempotency-Key 头", async () => {
    grantCredits.mockResolvedValue({ lotId: "9", duplicated: false, existingBizId: null });
    const { controller, sessions } = createController();

    const result = await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      { action: "adjustBalance", reason: "补偿", value: 10 },
      undefined,
      "key-1",
    );

    expect(grantCredits).toHaveBeenCalledWith({
      userId: 42,
      credits: 10,
      source: "gift",
      bizType: "grant",
      bizId: "key-1",
    });
    expect(result).toEqual({ success: true, data: { credits: 10, duplicated: false } });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("adjustBalance：幂等命中（409）时 credits 为 null、审计不写 value —— 不谎报一次发放", async () => {
    grantCredits.mockResolvedValue({ lotId: "", duplicated: true, existingBizId: "key-1" });
    const { controller, operationLog } = createController();

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        undefined,
        "key-1",
      ),
    ).resolves.toEqual({ success: true, data: { credits: null, duplicated: true } });

    const detail = JSON.parse(
      (operationLog.create.mock.calls[0]?.[0] as { detail: string }).detail,
    ) as Record<string, unknown>;
    expect(detail).toMatchObject({ duplicated: true });
    expect(detail).not.toHaveProperty("value");
  });

  it("adjustBalance：用户不存在 → 404，一笔都不发（billing 没有用户表，没人兜底）", async () => {
    const { controller } = createController({
      userExists: vi.fn().mockResolvedValue(false),
    });

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        undefined,
        "key-1",
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("adjustBalance：value 超过安全整数范围 → 400（JS 已经四舍五入过，放过去就是发错数）", async () => {
    const { controller } = createController();

    for (const value of [1e21, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        controller.manage(
          ADMIN_CTX.user,
          ADMIN_CTX.rawUserId,
          { action: "adjustBalance", reason: "补偿", value },
          undefined,
          "key-1",
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("adjustBalance：审计 action 落 user.adjust_balance 且 detail 带 value", async () => {
    grantCredits.mockResolvedValue({ lotId: "9", duplicated: false, existingBizId: null });
    const { controller, operationLog } = createController();

    await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      { action: "adjustBalance", reason: "补偿", value: 10 },
      undefined,
      "key-1",
    );

    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.adjust_balance",
        target: "user:42",
        detail: expect.stringContaining('"value":10'),
      }),
    );
  });

  it("adjustBalance：缺 Idempotency-Key → 400，一笔都不发", async () => {
    const { controller } = createController();

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        undefined,
        "   ",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("adjustBalance：value 须为正整数（0/负数/小数/非数字/缺失全拒），一笔都不发", async () => {
    const { controller } = createController();

    for (const value of [0, -5, 1.5, "10", undefined, null, Number.NaN]) {
      await expect(
        controller.manage(
          ADMIN_CTX.user,
          ADMIN_CTX.rawUserId,
          { action: "adjustBalance", reason: "补偿", value },
          undefined,
          "key-1",
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("adjustBalance：billing 管理端没配 → 503（重试不会好，要人去改配置）", async () => {
    grantCredits.mockRejectedValue(new BillingAdminConfigError("缺 BILLING_ADMIN_URL"));
    const { controller, operationLog } = createController();

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        undefined,
        "key-1",
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(operationLog.create).not.toHaveBeenCalled();
  });

  it("adjustBalance：billing 调用失败 → 502 且带原因，绝不静默成功", async () => {
    grantCredits.mockRejectedValue(new BillingAdminError("billing 管理端返回 HTTP 500"));
    const { controller } = createController();

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        undefined,
        "key-1",
      ),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("发放积分失败") });
  });

  it("adjustBalance：网络层失败（连接被拒/超时）也是 502，不是 500", async () => {
    grantCredits.mockRejectedValue(new TypeError("fetch failed"));
    const { controller } = createController();

    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        undefined,
        "key-1",
      ),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("不可达") });
  });

  it("userId 非正整数或 reason 缺失 → 400，不调任何写操作", async () => {
    const { controller, identity, sessions } = createController();
    for (const bad of [
      { rawUserId: "abc", body: { action: "freeze", reason: "x" } },
      { rawUserId: "-1", body: { action: "freeze", reason: "x" } },
      { rawUserId: "42", body: { action: "freeze" } },
      { rawUserId: "42", body: { action: "kick", reason: "x" } },
    ]) {
      await expect(
        controller.manage(ADMIN_CTX.user, bad.rawUserId, bad.body),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(identity.setUserStatus).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});

describe("AdminUsersController.manage（IKJABH 重置密码）", () => {
  beforeEach(() => {
    grantCredits.mockReset();
  });

  const RESET = { action: "reset_password", reason: "用户报障", password: "TempPass123" };

  function call(controller: AdminUsersController, body: unknown, rawUserId = "42") {
    return controller.manage(USER, rawUserId, body as Record<string, unknown>);
  }

  it("重置：写新口令 → 踢该用户全部会话 → 审计 user.reset_password", async () => {
    const { controller, identity, sessions, operationLog } = createController({
      revokeAllForUser: vi.fn().mockResolvedValue(2),
    });

    const result = await call(controller, RESET);

    expect(identity.resetPassword).toHaveBeenCalledWith(42, "TempPass123");
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42);
    expect(result).toEqual({ success: true, data: { revokedSessions: 2 } });
    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "user",
        action: "user.reset_password",
        target: "user:42",
        targetUserId: "42",
        detail: expect.stringContaining('"revokedSessions":2'),
      }),
    );
  });

  it("★ 不能重置自己 → 400，一个字都不写", async () => {
    const { controller, identity, sessions } = createController();

    await expect(call(controller, RESET, "1")).rejects.toMatchObject({ status: 400 });

    expect(identity.resetPassword).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("★ 不能重置持有 super_admin 的账号 → 403，一个字都不写", async () => {
    const { controller, identity, sessions } = createController({
      listRoleCodes: vi.fn().mockResolvedValue(["user", "super_admin"]),
    });

    await expect(call(controller, RESET)).rejects.toMatchObject({ status: 403 });

    expect(identity.resetPassword).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("重置目标不存在 → 404（billing 那边没有用户表，没人兜底）", async () => {
    const { controller, identity } = createController({
      userExists: vi.fn().mockResolvedValue(false),
    });

    await expect(call(controller, RESET)).rejects.toMatchObject({ status: 404 });
    expect(identity.resetPassword).not.toHaveBeenCalled();
  });

  it("口令不合规（PasswordPolicyError）→ 400 而不是 500", async () => {
    const { controller, sessions } = createController({
      resetPassword: vi
        .fn()
        .mockRejectedValue(new PasswordPolicyError("密码至少 8 位")),
    });

    await expect(call(controller, RESET)).rejects.toMatchObject({
      status: 400,
      message: "密码至少 8 位",
    });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("password 缺失 / 非字符串 → 400，不写库", async () => {
    const { controller, identity } = createController();

    for (const password of [undefined, "", 12345678, null]) {
      await expect(
        call(controller, { ...RESET, password }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(identity.resetPassword).not.toHaveBeenCalled();
  });

  it("会话踢出失败为 best-effort：仍成功，审计记 revokeError", async () => {
    const { controller, operationLog } = createController({
      revokeAllForUser: vi.fn().mockRejectedValue(new Error("redis timeout")),
    });

    const result = await call(controller, RESET);

    expect(result).toEqual({ success: true, data: { revokedSessions: 0 } });
    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('"revokeError":"redis timeout"'),
      }),
    );
  });
});

describe("AdminUsersController.list（余额三列来自 billing）", () => {
  it("billing 管理端没配 → 503（重试不会好，要人去改配置）", async () => {
    const { controller } = createController({
      listAdminUsers: vi
        .fn()
        .mockRejectedValue(new BillingAdminConfigError("缺 BILLING_ADMIN_URL")),
    });

    await expect(controller.list(USER, {})).rejects.toMatchObject({ status: 503 });
  });

  it("billing 调用失败 → 502 且带原因，不回落成空列表", async () => {
    const { controller } = createController({
      listAdminUsers: vi.fn().mockRejectedValue(new BillingAdminError("服务不可用")),
    });

    await expect(controller.list(USER, {})).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("用户列表查询失败"),
    });
  });

  it("库自己出错时原样抛出，不冒充 billing 故障", async () => {
    const { controller } = createController({
      listAdminUsers: vi.fn().mockRejectedValue(new Error("prisma 炸了")),
    });

    const error = await controller.list(USER, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("prisma 炸了");
    expect((error as { status?: number }).status).toBeUndefined();
  });
});
