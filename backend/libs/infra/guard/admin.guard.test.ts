import type { ExecutionContext } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminGuard } from "./admin.guard.js";

/** 造一个只带 request.user 的执行上下文——守卫只读这一处。 */
function contextFor(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const USER = { userId: "42", username: "alice", isAdmin: false };

function createGuard(isAdmin: ReturnType<typeof vi.fn>) {
  return new AdminGuard({ isAdmin } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminGuard（权威来源 = bw_user_roles）", () => {
  it("持有 admin 角色就放行", async () => {
    const isAdmin = vi.fn().mockResolvedValue(true);
    await expect(createGuard(isAdmin).canActivate(contextFor(USER))).resolves.toBe(true);
    expect(isAdmin).toHaveBeenCalledWith("42");
  });

  it("没有角色 → 403", async () => {
    const isAdmin = vi.fn().mockResolvedValue(false);
    await expect(createGuard(isAdmin).canActivate(contextFor(USER))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("没登录 → 401，且**不去查角色表**", async () => {
    const isAdmin = vi.fn();
    await expect(createGuard(isAdmin).canActivate(contextFor(undefined))).rejects.toMatchObject({
      status: 401,
    });
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it("判定结果回写到 user.isAdmin，供下游复用", async () => {
    const isAdmin = vi.fn().mockResolvedValue(true);
    const user = { userId: "42", username: "alice", isAdmin: false };

    await createGuard(isAdmin).canActivate(contextFor(user));

    // AdminController.session 直接读它 —— 不回写的话那个接口会报 isAdmin=false，
    // 而请求刚刚被守卫放行，前端会看到自相矛盾的两个答案。
    expect(user.isAdmin).toBe(true);
    expect(isAdmin).toHaveBeenCalledTimes(1);
  });

  it("★ 不看会话里的 isAdmin —— 那来自 new-api，断链后会全体失效", async () => {
    // 会话说“是管理员”，但角色表没有 → 必须拒绝。
    // 这是本轮改动的核心：旧的 `if (!user.isAdmin)` 会直接放行这个请求。
    const isAdmin = vi.fn().mockResolvedValue(false);
    const staleAdmin = { userId: "42", username: "alice", isAdmin: true };

    await expect(
      createGuard(isAdmin).canActivate(contextFor(staleAdmin)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("角色表说没有，会话说没有 → 403（默认拒绝）", async () => {
    const isAdmin = vi.fn().mockResolvedValue(false);
    await expect(createGuard(isAdmin).canActivate(contextFor(USER))).rejects.toMatchObject({
      status: 403,
    });
  });
});
