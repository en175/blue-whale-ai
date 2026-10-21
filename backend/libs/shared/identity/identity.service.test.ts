import { describe, expect, it, vi } from "vitest";


const repos = vi.hoisted(() => ({
  createIdentityUserRepo: vi.fn(),
  createIdentityRoleRepo: vi.fn(),
  createIdentityMembershipRepo: vi.fn(),
  createIdentityLoginLogRepo: vi.fn(),
  createAdminUserQuery: vi.fn(),
  createAuthRepo: vi.fn(),
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
vi.mock("@lib/shared/persistence/auth-repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthRepo: repos.createAuthRepo,
}));

import { hashPassword } from "@lib/shared/identity/password.js";
import {
  AccountDeletedError,
  AccountDisabledError,
  CodeAttemptsExhaustedError,
  CodeExpiredError,
  CodeWrongError,
  IdentityService,
  InvalidCredentialsError,
} from "./identity.service.js";
import type { IdentityUserRow } from "@lib/shared/persistence/identity-user-repo.js";

const OLD_PASSWORD = "OldPass123";

async function buildService(user: Partial<IdentityUserRow> | null) {
  const users = {
    findById: vi.fn().mockResolvedValue(user),
    updatePassword: vi.fn().mockResolvedValue(undefined),
  };
  repos.createIdentityUserRepo.mockReturnValue(users);
  repos.createIdentityRoleRepo.mockReturnValue({
    listRoleCodes: vi.fn().mockResolvedValue([]),
  });
  repos.createIdentityMembershipRepo.mockReturnValue({});
  repos.createIdentityLoginLogRepo.mockReturnValue({});
  repos.createAdminUserQuery.mockReturnValue({});
  repos.createAuthRepo.mockReturnValue({});

  return { service: new IdentityService({ client: {} } as never), users };
}

function userRow(over: Partial<IdentityUserRow> = {}): IdentityUserRow {
  return {
    id: "42",
    username: "alice",
    nickname: null,
    email: null,
    phone: null,
    status: "NORMAL",
    password: null,
    mustChangePassword: false,
    ...over,
  };
}

describe("IdentityService.changePassword", () => {
  it("有口令但是原密码错 → InvalidCredentialsError，一个字节都不落库", async () => {
    const { service, users } = await buildService(
      userRow({ password: await hashPassword(OLD_PASSWORD) }),
    );

    await expect(
      service.changePassword("42", { oldPassword: "WrongPass", newPassword: "NewPass456" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(users.updatePassword).not.toHaveBeenCalled();
  });

  it("有口令但压根没传原密码 → 同样拒绝（不能把「漏传」当成「没有口令」）", async () => {
    const { service, users } = await buildService(
      userRow({ password: await hashPassword(OLD_PASSWORD) }),
    );

    await expect(
      service.changePassword("42", { newPassword: "NewPass456" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(users.updatePassword).not.toHaveBeenCalled();
  });

  it("★ 无口令账号（手机号建号）不带原密码也能设密码（IKJA4R）", async () => {
    const { service, users } = await buildService(userRow({ password: null }));

    await expect(
      service.changePassword("42", { newPassword: "BrandNew456" }),
    ).resolves.toBe(false);
    expect(users.updatePassword).toHaveBeenCalledWith("42", expect.any(String), false);
  });

  it("有口令且原密码正确 → 写新口令，并清掉强制改密标记", async () => {
    const { service, users } = await buildService(
      userRow({ password: await hashPassword(OLD_PASSWORD), mustChangePassword: true }),
    );

    await expect(
      service.changePassword("42", { oldPassword: OLD_PASSWORD, newPassword: "NewPass456" }),
    ).resolves.toBe(true);
    expect(users.updatePassword).toHaveBeenCalledWith("42", expect.any(String), false);
  });

  it("用户不存在 → InvalidCredentialsError", async () => {
    const { service, users } = await buildService(null);

    await expect(
      service.changePassword("42", { newPassword: "NewPass456" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(users.updatePassword).not.toHaveBeenCalled();
  });
});

describe("IdentityService.resetPassword", () => {
  it("★ 不验原密码，写新口令并**置上**强制改密标记", async () => {
    const { service, users } = await buildService(
      userRow({ password: await hashPassword(OLD_PASSWORD) }),
    );

    await service.resetPassword(42, "TempPass123");

    expect(users.updatePassword).toHaveBeenCalledWith("42", expect.any(String), true);
  });

  it("目标用户不存在 → InvalidCredentialsError（管理员端据此回 404）", async () => {
    const { service, users } = await buildService(null);

    await expect(service.resetPassword(42, "TempPass123")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(users.updatePassword).not.toHaveBeenCalled();
  });
});

describe("IdentityService.loginWithPhoneCode", () => {
  function buildPhoneService(config: {
    active?: { id: string; code: string; attempts: number } | null;
    phoneUser?: { id: string; username: string; nickname: string | null; phone: string; status: string; isDelete: boolean; created: boolean } | null;
    createdUser?: { id: string; username: string; nickname: string | null; phone: string; status: string; isDelete: boolean; created: boolean };
    consumed?: boolean;
    attempts?: number;
  }) {
    const authCodes = {
      findActiveCode: vi.fn().mockResolvedValue(config.active ?? null),
      incrementAttempts: vi.fn().mockResolvedValue(config.attempts ?? 1),
      consumeCode: vi.fn().mockResolvedValue(config.consumed ?? true),
      findByPhone: vi.fn().mockResolvedValue(config.phoneUser ?? null),
      upsertUser: vi.fn().mockResolvedValue(config.createdUser ?? null),
    };
    const users = {
      findById: vi.fn().mockResolvedValue(userRow({ phone: "13800001234" })),
    };
    const roles = { listRoleCodes: vi.fn().mockResolvedValue([]), grant: vi.fn().mockResolvedValue(undefined) };
    repos.createIdentityUserRepo.mockReturnValue(users);
    repos.createIdentityRoleRepo.mockReturnValue(roles);
    repos.createIdentityMembershipRepo.mockReturnValue({});
    repos.createIdentityLoginLogRepo.mockReturnValue({});
    repos.createAdminUserQuery.mockReturnValue({});
    repos.createAuthRepo.mockReturnValue(authCodes);
    const service = new IdentityService({ client: {} } as never);
    return { service, authCodes, users, roles };
  }

  const active = { id: "9", code: "123456", attempts: 0 };

  it("没有有效码（过期/已用/用途不符）→ CodeExpiredError", async () => {
    const { service } = buildPhoneService({ active: null });
    await expect(
      service.loginWithPhoneCode({ phone: "13800001234", code: "123456" }),
    ).rejects.toBeInstanceOf(CodeExpiredError);
  });

  it("码错一次 → CodeWrongError 带剩余次数，不消费码", async () => {
    const { service, authCodes } = buildPhoneService({ active, attempts: 1 });
    await expect(
      service.loginWithPhoneCode({ phone: "13800001234", code: "000000" }),
    ).rejects.toMatchObject({ name: "CodeWrongError", remaining: 4 });
    expect(authCodes.consumeCode).not.toHaveBeenCalled();
  });

  it("错满 5 次 → 码作废并报 CodeAttemptsExhaustedError", async () => {
    const { service, authCodes } = buildPhoneService({ active, attempts: 5 });
    await expect(
      service.loginWithPhoneCode({ phone: "13800001234", code: "000000" }),
    ).rejects.toBeInstanceOf(CodeAttemptsExhaustedError);
    expect(authCodes.consumeCode).toHaveBeenCalledWith("9");
  });

  it("禁用账号：验证码正确也拒绝，且不消费码（改绑/停用恢复后仍可用原码）", async () => {
    const { service, authCodes } = buildPhoneService({
      active,
      phoneUser: {
        id: "42",
        username: "alice",
        nickname: null,
        phone: "13800001234",
        status: "DISABLED",
        isDelete: false,
        created: false,
      },
    });
    await expect(
      service.loginWithPhoneCode({ phone: "13800001234", code: "123456" }),
    ).rejects.toBeInstanceOf(AccountDisabledError);
    expect(authCodes.consumeCode).not.toHaveBeenCalled();
  });

  it("软删账号：拒绝且不建替代身份", async () => {
    const { service, authCodes } = buildPhoneService({
      active,
      phoneUser: {
        id: "42",
        username: "alice",
        nickname: null,
        phone: "13800001234",
        status: "NORMAL",
        isDelete: true,
        created: false,
      },
    });
    await expect(
      service.loginWithPhoneCode({ phone: "13800001234", code: "123456" }),
    ).rejects.toBeInstanceOf(AccountDeletedError);
    expect(authCodes.upsertUser).not.toHaveBeenCalled();
  });

  it("并发重复提交：码已被另一请求消费 → CodeExpiredError，不重复建号", async () => {
    const { service, authCodes } = buildPhoneService({ active, consumed: false });
    await expect(
      service.loginWithPhoneCode({ phone: "13800001234", code: "123456" }),
    ).rejects.toBeInstanceOf(CodeExpiredError);
    expect(authCodes.upsertUser).not.toHaveBeenCalled();
  });

  it("新号：建号后授予普通用户角色，isNewUser=true", async () => {
    const { service, roles } = buildPhoneService({
      active,
      createdUser: {
        id: "42",
        username: "用户0001",
        nickname: "蓝鲸用户_Ab12Cd",
        phone: "13800001234",
        status: "NORMAL",
        isDelete: false,
        created: true,
      },
    });
    const out = await service.loginWithPhoneCode({ phone: "13800001234", code: "123456" });
    expect(out.isNewUser).toBe(true);
    expect(roles.grant).toHaveBeenCalledWith("42", "user", "phone-register");
  });

  it("老号：不重复授角色，isNewUser=false", async () => {
    const { service, roles } = buildPhoneService({
      active,
      phoneUser: {
        id: "42",
        username: "alice",
        nickname: "老昵称",
        phone: "13800001234",
        status: "NORMAL",
        isDelete: false,
        created: false,
      },
      createdUser: {
        id: "42",
        username: "alice",
        nickname: "老昵称",
        phone: "13800001234",
        status: "NORMAL",
        isDelete: false,
        created: false,
      },
    });
    const out = await service.loginWithPhoneCode({ phone: "13800001234", code: "123456" });
    expect(out.isNewUser).toBe(false);
    expect(roles.grant).not.toHaveBeenCalled();
  });
});
