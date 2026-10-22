import { describe, expect, it, vi } from "vitest";

const repos = vi.hoisted(() => ({
  createIdentityUserRepo: vi.fn(),
  createIdentityRoleRepo: vi.fn(),
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
vi.mock("@lib/shared/persistence/auth-repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthRepo: repos.createAuthRepo,
}));

import { CodeExpiredError } from "@lib/shared/auth/phone-verification.service.js";
import {
  AccountDeletedError,
  AccountDisabledError,
  InvalidCredentialsError,
  MigrationIneligibleError,
  PhoneAlreadyBoundError,
  PhoneNotBoundError,
  RebindBindingChangedError,
  RebindSamePhoneError,
} from "./identity.service.js";
import { PhoneBindingService } from "./phone-binding.service.js";
import { hashPassword } from "./password.js";

function row(over: Record<string, unknown> = {}) {
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

function build(over: {
  user?: ReturnType<typeof row> | null;
  loginUser?: ReturnType<typeof row> | null;
  phoneRow?: Record<string, unknown> | null;
  upsert?: Record<string, unknown>;
} = {}) {
  const users = {
    findById: vi.fn().mockResolvedValue(over.user === undefined ? row() : over.user),
    findByLoginName: vi
      .fn()
      .mockResolvedValue(over.loginUser === undefined ? row() : over.loginUser),
    findByPhoneIncludingDeleted: vi
      .fn()
      .mockResolvedValue(over.phoneRow === undefined ? null : over.phoneRow),
    upsertPhone: vi.fn().mockResolvedValue(
      over.upsert ?? {
        user: row({ phone: "13800001234" }),
        created: true,
        deleted: false,
      },
    ),
    updatePhone: vi.fn().mockResolvedValue(undefined),
  };
  const roles = {
    listRoleCodes: vi.fn().mockResolvedValue(["user"]),
    grant: vi.fn().mockResolvedValue(undefined),
  };
  repos.createIdentityUserRepo.mockReturnValue(users);
  repos.createIdentityRoleRepo.mockReturnValue(roles);
  const verification = {
    verify: vi.fn().mockResolvedValue({ codeId: "9" }),
    consume: vi.fn().mockResolvedValue(undefined),
  };
  const service = new PhoneBindingService(
    { client: {} } as never,
    verification as never,
  );
  return { service, users, roles, verification };
}

describe("PhoneBindingService.loginWithPhoneCode", () => {
  it("新号：按 login + legacy 用途校验，消费验证码，建号并授普通用户角色", async () => {
    const { service, users, roles, verification } = build();
    const out = await service.loginWithPhoneCode({
      phone: "13800001234",
      code: "123456",
    });
    expect(verification.verify).toHaveBeenCalledWith({
      phone: "13800001234",
      code: "123456",
      purposes: ["login", "legacy"],
    });
    expect(verification.consume).toHaveBeenCalledWith({ codeId: "9" });
    expect(users.upsertPhone).toHaveBeenCalledWith("13800001234");
    expect(roles.grant).toHaveBeenCalledWith("42", "user", "phone-register");
    expect(out.isNewUser).toBe(true);
    expect(out.result.userId).toBe(42);
  });

  it("老号：不重复授角色，isNewUser=false", async () => {
    const { service, roles, users } = build({
      upsert: {
        user: row({ phone: "13800001234" }),
        created: false,
        deleted: false,
      },
    });
    const out = await service.loginWithPhoneCode({
      phone: "13800001234",
      code: "123456",
    });
    expect(roles.grant).not.toHaveBeenCalled();
    expect(users.upsertPhone).toHaveBeenCalled();
    expect(out.isNewUser).toBe(false);
  });

  it("账号停用：拒绝且不消费验证码", async () => {
    const { service, verification } = build({
      phoneRow: { user: row({ status: "DISABLED" }), deleted: false },
    });
    await expect(
      service.loginWithPhoneCode({ phone: "13800001234", code: "123456" }),
    ).rejects.toThrow(AccountDisabledError);
    expect(verification.consume).not.toHaveBeenCalled();
  });

  it("账号软删：拒绝", async () => {
    const { service } = build({
      phoneRow: { user: row(), deleted: true },
    });
    await expect(
      service.loginWithPhoneCode({ phone: "13800001234", code: "123456" }),
    ).rejects.toThrow(AccountDeletedError);
  });

  it("验证码失败原样抛出", async () => {
    const { service, verification } = build();
    verification.verify.mockRejectedValue(new CodeExpiredError());
    await expect(
      service.loginWithPhoneCode({ phone: "13800001234", code: "123456" }),
    ).rejects.toThrow(CodeExpiredError);
  });
});

describe("PhoneBindingService 补绑 / 换绑", () => {
  it("已绑号不能补绑", async () => {
    const { service } = build({ user: row({ phone: "13900000000" }) });
    await expect(
      service.bindPhone("42", { phone: "13800001234", code: "123456" }),
    ).rejects.toThrow(PhoneAlreadyBoundError);
  });

  it("补绑：按 bind + legacy 校验并消费，随后更新手机号", async () => {
    const { service, users, verification } = build();
    await service.bindPhone("42", { phone: "13800001234", code: "123456" });
    expect(verification.verify).toHaveBeenCalledWith({
      phone: "13800001234",
      code: "123456",
      purposes: ["bind", "legacy"],
    });
    expect(users.updatePhone).toHaveBeenCalledWith("42", "13800001234");
  });

  it("未绑号不能发起换绑", async () => {
    const { service } = build({ user: row({ phone: null }) });
    await expect(service.rebindVerifyCurrent("42", "123456")).rejects.toThrow(
      PhoneNotBoundError,
    );
  });

  it("验证原号：按 rebind_old 校验并返回旧号", async () => {
    const { service, verification } = build({ user: row({ phone: "13800001234" }) });
    const out = await service.rebindVerifyCurrent("42", "123456");
    expect(out).toEqual({ oldPhone: "13800001234" });
    expect(verification.verify).toHaveBeenCalledWith({
      phone: "13800001234",
      code: "123456",
      purposes: ["rebind_old"],
    });
  });

  it("提交换绑：原绑定已变化 / 同号分别拒绝", async () => {
    await expect(
      build({ user: row({ phone: "13900000000" }) }).service.commitRebind("42", {
        oldPhone: "13800001234",
        phone: "13700000000",
        code: "123456",
      }),
    ).rejects.toThrow(RebindBindingChangedError);
    await expect(
      build({ user: row({ phone: "13800001234" }) }).service.commitRebind("42", {
        oldPhone: "13800001234",
        phone: "13800001234",
        code: "123456",
      }),
    ).rejects.toThrow(RebindSamePhoneError);
  });

  it("提交换绑成功：按 rebind_new 校验并只更新手机号", async () => {
    const { service, users, verification } = build({
      user: row({ phone: "13800001234" }),
    });
    const out = await service.commitRebind("42", {
      oldPhone: "13800001234",
      phone: "13700000000",
      code: "123456",
    });
    expect(out).toEqual({ phone: "13700000000" });
    expect(verification.verify).toHaveBeenCalledWith({
      phone: "13700000000",
      code: "123456",
      purposes: ["rebind_new"],
    });
    expect(users.updatePhone).toHaveBeenCalledWith("42", "13700000000");
  });
});

describe("PhoneBindingService 内部账号迁移", () => {
  it("账号不存在 / 无口令 → 统一 InvalidCredentialsError", async () => {
    await expect(
      build({ loginUser: null }).service.verifyMigrationCandidate({
        username: "alice",
        password: "x",
      }),
    ).rejects.toThrow(InvalidCredentialsError);
    await expect(
      build({ loginUser: row({ password: null }) }).service.verifyMigrationCandidate({
        username: "alice",
        password: "x",
      }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it("已绑号 → 不可迁移", async () => {
    const hash = await hashPassword("Passw0rd!");
    const { service } = build({
      loginUser: row({ password: hash, phone: "13800001234" }),
    });
    await expect(
      service.verifyMigrationCandidate({
        username: "alice",
        password: "Passw0rd!",
      }),
    ).rejects.toThrow(MigrationIneligibleError);
  });

  it("密码正确且未绑号 → 返回用户 id", async () => {
    const hash = await hashPassword("Passw0rd!");
    const { service } = build({
      loginUser: row({ password: hash, phone: null }),
    });
    const out = await service.verifyMigrationCandidate({
      username: "alice",
      password: "Passw0rd!",
    });
    expect(out).toEqual({ userId: "42" });
  });

  it("补绑：按 bind + legacy 校验，更新后回读用户", async () => {
    const { service, users, verification } = build();
    const out = await service.commitMigrationBind("42", {
      phone: "13800001234",
      code: "123456",
    });
    expect(verification.verify).toHaveBeenCalledWith({
      phone: "13800001234",
      code: "123456",
      purposes: ["bind", "legacy"],
    });
    expect(users.updatePhone).toHaveBeenCalledWith("42", "13800001234");
    expect(out.id).toBe("42");
  });

  it("补绑时资格不符 → MigrationIneligibleError", async () => {
    const { service } = build({ user: row({ phone: "13800001234" }) });
    await expect(
      service.commitMigrationBind("42", {
        phone: "13700000000",
        code: "123456",
      }),
    ).rejects.toThrow(MigrationIneligibleError);
  });
});
