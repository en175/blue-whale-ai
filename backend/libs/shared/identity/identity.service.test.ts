import { describe, expect, it, vi } from "vitest";


const repos = vi.hoisted(() => ({
  createIdentityUserRepo: vi.fn(),
  createIdentityRoleRepo: vi.fn(),
}));

vi.mock("@lib/shared/persistence/identity-user-repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createIdentityUserRepo: repos.createIdentityUserRepo,
}));
vi.mock("@lib/shared/persistence/identity-role-repo.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createIdentityRoleRepo: repos.createIdentityRoleRepo,
}));

import { hashPassword } from "@lib/shared/identity/password.js";
import {
  IdentityService,
  InvalidCredentialsError,
  NicknameInvalidError,
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

describe("IdentityService 昵称", () => {
  function build(config: { user?: Partial<IdentityUserRow> | null }) {
    const users = {
      findById: vi.fn().mockResolvedValue(config.user === null ? null : userRow(config.user ?? {})),
      updateNickname: vi.fn().mockResolvedValue(undefined),
    };
    repos.createIdentityUserRepo.mockReturnValue(users);
    repos.createIdentityRoleRepo.mockReturnValue({ listRoleCodes: vi.fn().mockResolvedValue([]) });
    return { service: new IdentityService({ client: {} } as never), users };
  }

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
