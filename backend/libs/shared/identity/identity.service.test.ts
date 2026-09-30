import { describe, expect, it, vi } from "vitest";

/**
 * IKJABH / IKJA4R：口令读写的那几条分支。
 *
 * <p>这个文件存在的理由只有一条：**这里是「谁能改这个账号的口令」的唯一判定点**。
 * 三条分支各有各的坏法，而且都坏得不出声：
 *
 * <ul>
 *   <li>有口令却不验原密码 → 拿到一个会话就能改掉别人的口令；</li>
 *   <li>无口令账号也去验原密码 → 手机号建号的用户**永远设不上密码**（IKJA4R 修的洞）；</li>
 *   <li>改完不清 `must_change_password` → 被重置过的人每次登录都被拦去改密，改完还拦。</li>
 * </ul>
 *
 * <p>用真的 `hashPassword` / `verifyPassword`（bcrypt cost 10，几十毫秒），
 * 不 mock —— 换掉它们等于把「原密码到底有没有被验过」这件事本身 mock 掉了。
 */

const repos = vi.hoisted(() => ({
  createIdentityUserRepo: vi.fn(),
  createIdentityRoleRepo: vi.fn(),
  createIdentityMembershipRepo: vi.fn(),
  createIdentityLoginLogRepo: vi.fn(),
  createAdminUserQuery: vi.fn(),
  createAuthRepo: vi.fn(),
}));

// 只换**工厂**，同名模块里还有 `USER_STATUS_NORMAL` 这类常量，服务是直接读的。
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
    // 定义性区别就在这：设置密码没有可验的旧凭证，所以不要求原密码。
    // 少了这个分支，`password IS NULL` 的账号会永远卡在「原密码错误」上。
    const { service, users } = await buildService(userRow({ password: null }));

    await expect(
      service.changePassword("42", { newPassword: "BrandNew456" }),
    ).resolves.toBe(false);
    // 第三个参数 false = 清掉强制改密标记
    expect(users.updatePassword).toHaveBeenCalledWith("42", expect.any(String), false);
  });

  it("有口令且原密码正确 → 写新口令，并清掉强制改密标记", async () => {
    const { service, users } = await buildService(
      userRow({ password: await hashPassword(OLD_PASSWORD), mustChangePassword: true }),
    );

    // 返回 true 才是重点：调用方据此**豁免当前会话**（IKJABH 任务 5）。
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
    // 置位是这一步的全部意义：不置的话管理员交付的临时口令永久有效，
    // 而管理员是知道它的。
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
