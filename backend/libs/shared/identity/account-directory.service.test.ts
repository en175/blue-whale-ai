import { describe, expect, it, vi } from "vitest";

const repos = vi.hoisted(() => ({
  createIdentityUserRepo: vi.fn(),
  createIdentityRoleRepo: vi.fn(),
  createIdentityMembershipRepo: vi.fn(),
  createIdentityLoginLogRepo: vi.fn(),
  createAdminUserQuery: vi.fn(),
}));

vi.mock("@lib/shared/persistence/identity-user-repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createIdentityUserRepo: repos.createIdentityUserRepo,
}));
vi.mock("@lib/shared/persistence/identity-role-repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createIdentityRoleRepo: repos.createIdentityRoleRepo,
}));
vi.mock("@lib/shared/persistence/identity-membership-repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createIdentityMembershipRepo: repos.createIdentityMembershipRepo,
}));
vi.mock("@lib/shared/persistence/identity-login-log-repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createIdentityLoginLogRepo: repos.createIdentityLoginLogRepo,
}));
vi.mock("@lib/shared/persistence/admin-user-query.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAdminUserQuery: repos.createAdminUserQuery,
}));

import { LastSuperAdminError } from "@lib/core/identity/roles.js";
import { AccountDirectoryService } from "./account-directory.service.js";

function build(over: {
  user?: Record<string, unknown> | null;
  roleCodes?: string[];
  holders?: number;
} = {}) {
  const users = {
    findById: vi.fn().mockResolvedValue(
      over.user === undefined
        ? { id: "42", status: "NORMAL" }
        : over.user,
    ),
    updateStatus: vi.fn().mockResolvedValue(true),
  };
  const roles = {
    listRoleCodes: vi.fn().mockResolvedValue(over.roleCodes ?? []),
    isAdmin: vi.fn().mockResolvedValue(false),
    grant: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(1),
    countHolders: vi.fn().mockResolvedValue(over.holders ?? 2),
  };
  const memberships = {
    resolveTier: vi.fn().mockResolvedValue({ tier: "pro", unknownTiers: [] }),
  };
  const loginLogs = { record: vi.fn().mockResolvedValue(undefined) };
  const adminUsers = {
    listAdminUsers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    countAdminUsers: vi.fn().mockResolvedValue(3),
    findUserIdByKeyword: vi.fn().mockResolvedValue("42"),
    loadUserIdentities: vi.fn().mockResolvedValue({}),
  };
  repos.createIdentityUserRepo.mockReturnValue(users);
  repos.createIdentityRoleRepo.mockReturnValue(roles);
  repos.createIdentityMembershipRepo.mockReturnValue(memberships);
  repos.createIdentityLoginLogRepo.mockReturnValue(loginLogs);
  repos.createAdminUserQuery.mockReturnValue(adminUsers);
  return {
    service: new AccountDirectoryService({ client: {} } as never),
    users,
    roles,
    memberships,
    loginLogs,
    adminUsers,
  };
}

describe("AccountDirectoryService", () => {
  it("角色与管理员判断直接委托角色 repo", async () => {
    const { service, roles } = build({ roleCodes: ["user"] });
    expect(await service.listRoleCodes("42")).toEqual(["user"]);
    expect(await service.isAdmin("42")).toBe(false);
    expect(roles.listRoleCodes).toHaveBeenCalledWith("42");
    expect(roles.isAdmin).toHaveBeenCalledWith("42");
  });

  it("访问状态：用户存在时按角色 rank 与状态归一", async () => {
    const { service, roles } = build({
      user: { id: "42", status: "NORMAL" },
      roleCodes: ["admin"],
    });
    roles.listRoleCodes.mockResolvedValue(["admin"]);
    expect(await service.resolveAccessState("42")).toEqual({
      role: 10,
      status: 1,
    });
  });

  it("访问状态：用户不存在 → 最低角色 + 停用", async () => {
    const { service } = build({ user: null });
    expect(await service.resolveAccessState("42")).toEqual({
      role: 1,
      status: 0,
    });
  });

  it("保留最后一个 super_admin：撤销时拒绝", async () => {
    const { service, roles } = build({ roleCodes: ["super_admin"], holders: 1 });
    await expect(service.revokeRole("42", "super_admin")).rejects.toThrow(
      LastSuperAdminError,
    );
    expect(roles.revoke).not.toHaveBeenCalled();
  });

  it("普通角色撤销直接写库", async () => {
    const { service, roles } = build({ roleCodes: ["user"] });
    await service.revokeRole("42", "user");
    expect(roles.revoke).toHaveBeenCalledWith("42", "user");
  });

  it("登录日志与会员等级委托对应 repo", async () => {
    const { service, loginLogs, memberships } = build();
    await service.recordLogin({
      username: "alice",
      ip: "1.2.3.4",
      userAgent: "vitest",
      success: true,
    });
    expect(loginLogs.record).toHaveBeenCalled();
    expect(await service.resolveTier("42", new Date(0))).toBe("pro");
    expect(memberships.resolveTier).toHaveBeenCalledWith("42", new Date(0));
  });

  it("后台用户查询与状态写入委托 repo", async () => {
    const { service, adminUsers, users } = build();
    await service.listAdminUsers({ page: 1, pageSize: 20 });
    expect(adminUsers.listAdminUsers).toHaveBeenCalled();
    expect(await service.setUserStatus("42", "DISABLED")).toBe(true);
    expect(users.updateStatus).toHaveBeenCalledWith("42", "DISABLED");
  });
});
