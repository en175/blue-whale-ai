import { NewApiError } from "@blue-whale/core";
import { describe, expect, it, vi } from "vitest";

import { AdminUsersController } from "./users.controller.js";

// 冻结强制登出：freeze 动作在 upstream disable 成功后 best-effort 踢该用户全部会话，
// 审计 detail 记 revokedSessions；unfreeze/adjustBalance 不碰会话。

function createController(overrides: {
  manageAdminUser?: ReturnType<typeof vi.fn>;
  revokeAllForUser?: ReturnType<typeof vi.fn>;
  operationLogCreate?: ReturnType<typeof vi.fn>;
} = {}) {
  const account = { manageAdminUser: overrides.manageAdminUser ?? vi.fn().mockResolvedValue(undefined) };
  const operationLog = { create: overrides.operationLogCreate ?? vi.fn().mockResolvedValue(undefined) };
  const sessions = { revokeAllForUser: overrides.revokeAllForUser ?? vi.fn().mockResolvedValue(0) };
  const controller = new AdminUsersController(
    account as never,
    operationLog as never,
    sessions as never,
  );
  return { controller, account, operationLog, sessions };
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
  it("freeze：先上游 disable 成功，再踢该用户全部会话，返回吊销数", async () => {
    const { controller, account, sessions } = createController({
      revokeAllForUser: vi.fn().mockResolvedValue(3),
    });
    const order: string[] = [];
    account.manageAdminUser.mockImplementation(async () => {
      order.push("disable");
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
    expect(account.manageAdminUser).toHaveBeenCalledWith(
      "sk-admin-token",
      1,
      { id: 42, action: "disable" },
    );
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

  it("freeze：上游 disable 失败则不踢会话、整体失败", async () => {
    const { controller, sessions } = createController({
      manageAdminUser: vi.fn().mockRejectedValue(new NewApiError("上游失败", 500)),
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

  it("unfreeze：不调 revokeAllForUser，响应 data 为 null", async () => {
    const { controller, sessions } = createController();
    const result = await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      { action: "unfreeze", reason: "已改正" },
      ADMIN_CTX.authorization,
    );
    expect(result).toEqual({ success: true, data: null });
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    expect(controller).toBeDefined();
  });

  it("adjustBalance：不调 revokeAllForUser", async () => {
    const { controller, sessions } = createController();
    await controller.manage(
      ADMIN_CTX.user,
      ADMIN_CTX.rawUserId,
      { action: "adjustBalance", reason: "补偿", value: 10 },
      ADMIN_CTX.authorization,
    );
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("userId 非正整数或 reason 缺失 → 400，不调上游", async () => {
    const { controller, account, sessions } = createController();
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
    expect(account.manageAdminUser).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});
