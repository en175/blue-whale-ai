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
  MigrationIneligibleError,
  NicknameInvalidError,
  PhoneNotBoundError,
  RebindBindingChangedError,
  RebindSamePhoneError,
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

describe("IdentityService 换绑 / 迁移 / 昵称", () => {
  function build(config: {
    user?: Partial<IdentityUserRow> | null;
    code?: { id: string; code: string; attempts: number; purpose: string } | null;
    attempts?: number;
    consumed?: boolean;
  }) {
    const users = {
      findById: vi.fn().mockResolvedValue(config.user === null ? null : userRow(config.user ?? {})),
      findByLoginName: vi.fn().mockResolvedValue(
        config.user === null ? null : userRow(config.user ?? {}),
      ),
      updatePhone: vi.fn().mockResolvedValue(undefined),
      updateNickname: vi.fn().mockResolvedValue(undefined),
    };
    const authCodes = {
      findActiveCode: vi.fn().mockResolvedValue(config.code ?? null),
      incrementAttempts: vi.fn().mockResolvedValue(config.attempts ?? 1),
      consumeCode: vi.fn().mockResolvedValue(config.consumed ?? true),
      findByPhone: vi.fn(),
      upsertUser: vi.fn(),
    };
    repos.createIdentityUserRepo.mockReturnValue(users);
    repos.createIdentityRoleRepo.mockReturnValue({ listRoleCodes: vi.fn().mockResolvedValue([]) });
    repos.createIdentityMembershipRepo.mockReturnValue({});
    repos.createIdentityLoginLogRepo.mockReturnValue({});
    repos.createAdminUserQuery.mockReturnValue({});
    repos.createAuthRepo.mockReturnValue(authCodes);
    return { service: new IdentityService({ client: {} } as never), users, authCodes };
  }

  const code = { id: "9", code: "123456", attempts: 0, purpose: "bind" };

  it("未绑手机号时不能走换绑", async () => {
    const { service } = build({ user: { phone: null } });
    await expect(service.rebindVerifyCurrent("42", "123456")).rejects.toBeInstanceOf(
      PhoneNotBoundError,
    );
  });

  it("验证旧号成功返回旧号码并消费验证码", async () => {
    const { service, authCodes } = build({ user: { phone: "13800001234" }, code });
    await expect(service.rebindVerifyCurrent("42", "123456")).resolves.toEqual({
      oldPhone: "13800001234",
    });
    expect(authCodes.consumeCode).toHaveBeenCalledWith("9");
    expect(authCodes.findActiveCode).toHaveBeenCalledWith("13800001234", ["rebind_old"]);
  });

  it("旧号验证码错误 → CodeWrongError", async () => {
    const { service } = build({
      user: { phone: "13800001234" },
      code: { ...code, code: "000000" },
      attempts: 2,
    });
    await expect(service.rebindVerifyCurrent("42", "123456")).rejects.toMatchObject({
      remaining: 3,
    });
  });

  it("提交换绑：原绑定已变化 → RebindBindingChangedError，不改库", async () => {
    const { service, users } = build({
      user: { phone: "13900000000" },
      code,
    });
    await expect(
      service.commitRebind("42", {
        oldPhone: "13800001234",
        phone: "13700000000",
        code: "123456",
      }),
    ).rejects.toBeInstanceOf(RebindBindingChangedError);
    expect(users.updatePhone).not.toHaveBeenCalled();
  });

  it("提交换绑：新旧同号 → RebindSamePhoneError，不发码", async () => {
    const { service, authCodes } = build({ user: { phone: "13800001234" }, code });
    await expect(
      service.commitRebind("42", {
        oldPhone: "13800001234",
        phone: "13800001234",
        code: "123456",
      }),
    ).rejects.toBeInstanceOf(RebindSamePhoneError);
    expect(authCodes.findActiveCode).not.toHaveBeenCalled();
  });

  it("提交换绑成功：只改 phone，不动其他字段", async () => {
    const { service, users } = build({ user: { phone: "13800001234" }, code });
    await expect(
      service.commitRebind("42", {
        oldPhone: "13800001234",
        phone: "13700000000",
        code: "123456",
      }),
    ).resolves.toEqual({ phone: "13700000000" });
    expect(users.updatePhone).toHaveBeenCalledWith("42", "13700000000");
  });

  it("迁移验证：账号不存在/无口令 → 统一 InvalidCredentialsError", async () => {
    const { service } = build({ user: null });
    await expect(
      service.verifyMigrationCandidate({ username: "ghost", password: "x" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("迁移验证：密码正确且未绑号 → 返回用户 id", async () => {
    const { service } = build({
      user: { id: "42", username: "alice", password: await hashPassword("OldPass123") },
    });
    await expect(
      service.verifyMigrationCandidate({ username: "alice", password: "OldPass123" }),
    ).resolves.toEqual({ userId: "42" });
  });

  it("迁移验证：已绑号 → 不可迁移（与密码错误分开）", async () => {
    const { service } = build({
      user: {
        id: "42",
        username: "alice",
        phone: "13800001234",
        password: await hashPassword("OldPass123"),
      },
    });
    await expect(
      service.verifyMigrationCandidate({ username: "alice", password: "OldPass123" }),
    ).rejects.toBeInstanceOf(MigrationIneligibleError);
  });

  it("迁移补绑：绑号后回读用户", async () => {
    const { service, users } = build({
      user: { id: "42", username: "alice", password: await hashPassword("OldPass123") },
      code,
    });
    users.findById
      .mockResolvedValueOnce(userRow({ id: "42", username: "alice" }))
      .mockResolvedValueOnce(userRow({ id: "42", username: "alice", phone: "13800001234" }));

    await expect(
      service.commitMigrationBind("42", { phone: "13800001234", code: "123456" }),
    ).resolves.toMatchObject({ id: "42", phone: "13800001234" });
    expect(users.updatePhone).toHaveBeenCalledWith("42", "13800001234");
  });

  it("昵称非法 → NicknameInvalidError，不写库", async () => {
    const { service, users } = build({ user: {} });
    await expect(service.updateNickname("42", "小 明")).rejects.toBeInstanceOf(
      NicknameInvalidError,
    );
    expect(users.updateNickname).not.toHaveBeenCalled();
  });

  it("昵称相同 → changed=false，不写库", async () => {
    const { service, users } = build({ user: { nickname: "小明" } });
    await expect(service.updateNickname("42", " 小明 ")).resolves.toEqual({
      nickname: "小明",
      changed: false,
    });
    expect(users.updateNickname).not.toHaveBeenCalled();
  });

  it("昵称修改成功 → 写库并返回新值", async () => {
    const { service, users } = build({ user: { nickname: "小明" } });
    await expect(service.updateNickname("42", "小红")).resolves.toEqual({
      nickname: "小红",
      changed: true,
    });
    expect(users.updateNickname).toHaveBeenCalledWith("42", "小红");
  });
});
