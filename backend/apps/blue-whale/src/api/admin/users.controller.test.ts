import { describe, expect, it, vi } from "vitest";

import { AdminException } from "@lib/shared/errors/admin-error.js";
import { AdminUsersController } from "./users.controller.js";

// 冻结强制登出：freeze 在本地把 bw_users.status 置为 DISABLED 后 best-effort
// 踢该用户全部会话，审计 detail 记 revokedSessions；unfreeze 不碰会话。
// 加扣余额（adjustBalance）属计费域，尚未实现——必须显式报错，不能静默成功。

function createController(overrides: {
  setUserStatus?: ReturnType<typeof vi.fn>;
  revokeAllForUser?: ReturnType<typeof vi.fn>;
  operationLogCreate?: ReturnType<typeof vi.fn>;
} = {}) {
  const operationLog = { create: overrides.operationLogCreate ?? vi.fn().mockResolvedValue(undefined) };
  const sessions = { revokeAllForUser: overrides.revokeAllForUser ?? vi.fn().mockResolvedValue(0) };
  const identity = {
    listAdminUsers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    setUserStatus: overrides.setUserStatus ?? vi.fn().mockResolvedValue(true),
  };
  const controller = new AdminUsersController(
    identity as never,
    operationLog as never,
    sessions as never,
  );
  return { controller, identity, operationLog, sessions };
}

const USER = { userId: "1", username: "admin" } as never;
const BEARER = "Bearer sk-admin-token";
const ADMIN_CTX = {
  user: USER,
  rawUserId: "42",
  body: { action: "freeze", reason: "违规" },
  authorization: BEARER,
};

describe("AdminUsersController.manage（冻结强制登出）", () => {
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
      ADMIN_CTX.authorization,
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
      ADMIN_CTX.authorization,
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
      ADMIN_CTX.authorization,
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
        ADMIN_CTX.authorization,
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
        ADMIN_CTX.authorization,
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
      ADMIN_CTX.authorization,
    );
    expect(result).toEqual({ success: true, data: null });
    expect(identity.setUserStatus).toHaveBeenCalledWith(42, "NORMAL");
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("adjustBalance：计费域未接入 → 501 明确报错，不静默成功、不动会话", async () => {
    const { controller, sessions } = createController();
    await expect(
      controller.manage(
        ADMIN_CTX.user,
        ADMIN_CTX.rawUserId,
        { action: "adjustBalance", reason: "补偿", value: 10 },
        ADMIN_CTX.authorization,
      ),
    ).rejects.toBeInstanceOf(AdminException);
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
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
        controller.manage(ADMIN_CTX.user, bad.rawUserId, bad.body, BEARER),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(identity.setUserStatus).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});
