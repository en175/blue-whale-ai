import type { ExecutionContext } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SuperAdminGuard } from "./super-admin.guard.js";

function contextFor(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const USER = { userId: "42", username: "alice", isAdmin: true };

function createGuard(listRoleCodes: ReturnType<typeof vi.fn>) {
  return new SuperAdminGuard({ listRoleCodes } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SuperAdminGuard（权威来源 = bw_user_roles）", () => {
  it("持有 super_admin 角色就放行", async () => {
    const listRoleCodes = vi.fn().mockResolvedValue(["super_admin"]);
    await expect(createGuard(listRoleCodes).canActivate(contextFor(USER))).resolves.toBe(true);
    expect(listRoleCodes).toHaveBeenCalledWith("42");
  });

  it("★ 只有 admin 不算数 → 403", async () => {
    const listRoleCodes = vi.fn().mockResolvedValue(["user", "admin"]);
    await expect(createGuard(listRoleCodes).canActivate(contextFor(USER))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("没有任何角色 → 403", async () => {
    const listRoleCodes = vi.fn().mockResolvedValue([]);
    await expect(createGuard(listRoleCodes).canActivate(contextFor(USER))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("没登录 → 401，且**不去查角色表**", async () => {
    const listRoleCodes = vi.fn();
    await expect(
      createGuard(listRoleCodes).canActivate(contextFor(undefined)),
    ).rejects.toMatchObject({ status: 401 });
    expect(listRoleCodes).not.toHaveBeenCalled();
  });

  it("★ 不看会话里的 isAdmin —— 会话来自上游，不能当作超管依据", async () => {
    const listRoleCodes = vi.fn().mockResolvedValue(["user"]);
    const staleAdmin = { userId: "42", username: "alice", isAdmin: true };

    await expect(
      createGuard(listRoleCodes).canActivate(contextFor(staleAdmin)),
    ).rejects.toMatchObject({ status: 403 });
  });
});
