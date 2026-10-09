import { Injectable } from "@nestjs/common";

import { InvalidVerificationCodeError } from "@lib/core";
import type { Tier } from "@lib/core/identity/tier.js";
import {
  LastSuperAdminError,
  revokeWouldOrphanSuperAdmin,
  roleRank,
  ROLE_SUPER_ADMIN,
  ROLE_USER,
} from "@lib/core/identity/roles.js";
import { createLogger } from "@lib/core/logging";
import { createAuthRepo } from "@lib/shared/persistence/auth-repo.js";
import { createIdentityLoginLogRepo } from "@lib/shared/persistence/identity-login-log-repo.js";
import { createAdminUserQuery, type AdminUserListOptions } from "@lib/shared/persistence/admin-user-query.js";
import { createIdentityMembershipRepo } from "@lib/shared/persistence/identity-membership-repo.js";
import { createIdentityRoleRepo } from "@lib/shared/persistence/identity-role-repo.js";
import {
  createIdentityUserRepo,
  USER_STATUS_NORMAL,
  type IdentityUserRow,
  type IdentityUserStatus,
} from "@lib/shared/persistence/identity-user-repo.js";
import {
  burnVerificationTime,
  hashPassword,
  verifyPassword,
} from "@lib/shared/identity/password.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

export interface LocalLoginResult {
  userId: number;
  username: string;
  email: string | null;
  phone: string | null;
  hasPassword: boolean;
  mustChangePassword: boolean;
  role: number;
  status: number;
}

export interface AccountFlags {
  phone: string | null;
  hasPassword: boolean;
  mustChangePassword: boolean;
}

export class PhoneAlreadyBoundError extends Error {
  constructor() {
    super("当前账号已绑定手机号，暂不支持换绑");
    this.name = "PhoneAlreadyBoundError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("用户名或密码错误");
    this.name = "InvalidCredentialsError";
  }
}

@Injectable()
export class IdentityService {
  private readonly logger = createLogger("identity");
  private readonly memberships;
  private readonly roles;
  private readonly loginLogs;
  private readonly adminUsers;
  private readonly users;
  private readonly authCodes;

  constructor(prisma: PrismaService) {
    this.memberships = createIdentityMembershipRepo(prisma.client);
    this.roles = createIdentityRoleRepo(prisma.client);
    this.loginLogs = createIdentityLoginLogRepo(prisma.client);
    this.adminUsers = createAdminUserQuery(prisma.client);
    this.users = createIdentityUserRepo(prisma.client);
    this.authCodes = createAuthRepo(prisma.client);
  }

  private async toLoginResult(user: IdentityUserRow): Promise<LocalLoginResult> {
    return {
      userId: Number(user.id),
      username: user.username,
      email: user.email,
      phone: user.phone,
      hasPassword: user.password !== null,
      mustChangePassword: user.mustChangePassword,
      role: roleRank(await this.roles.listRoleCodes(user.id)),
      status: user.status === USER_STATUS_NORMAL ? 1 : 0,
    };
  }

  async login(input: { username: string; password: string }): Promise<LocalLoginResult> {
    const user = await this.users.findByLoginName(input.username);

    if (!user) {
      await burnVerificationTime(input.password);
      throw new InvalidCredentialsError();
    }

    if (!(await verifyPassword(input.password, user.password))) {
      throw new InvalidCredentialsError();
    }

    return this.toLoginResult(user);
  }

  async register(input: {
    username: string;
    password: string;
    email?: string | undefined;
  }): Promise<LocalLoginResult> {
    const passwordHash = await hashPassword(input.password);
    const created = await this.users.create({
      username: input.username,
      passwordHash,
      email: input.email ?? null,
    });

    try {
      await this.roles.grant(created.id, ROLE_USER, "self-register");
    } catch (error) {
      this.logger.error(
        `注册后授予 ${ROLE_USER} 角色失败（用户 ${created.id}）：` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return this.toLoginResult(created);
  }

  async loginWithPhoneCode(input: {
    phone: string;
    code: string;
  }): Promise<{ result: LocalLoginResult; isNewUser: boolean }> {
    const record = await this.authCodes.findValidCode(input.phone, input.code);
    if (!record) {
      throw new InvalidVerificationCodeError("验证码错误或已过期");
    }

    const user = await this.authCodes.upsertUser(input.phone);
    await this.authCodes.markCodeUsed(record.id);

    if (user.created) {
      try {
        await this.roles.grant(String(user.id), ROLE_USER, "phone-register");
      } catch (error) {
        this.logger.error(
          `手机号建号后授予 ${ROLE_USER} 角色失败（用户 ${user.id}）：` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const row = await this.users.findById(user.id);
    if (!row) {
      this.logger.error(
        `手机号登录找到的账号不可用（userId=${user.id}）——该行可能已被软删，且手机号仍被它占用`,
      );
      throw new InvalidCredentialsError();
    }

    return { result: await this.toLoginResult(row), isNewUser: user.created };
  }

  async bindPhone(
    userId: string | number,
    input: { phone: string; code: string },
  ): Promise<void> {
    const self = await this.users.findById(String(userId));
    if (!self) throw new InvalidCredentialsError();
    if (self.phone) throw new PhoneAlreadyBoundError();

    const record = await this.authCodes.findValidCode(input.phone, input.code);
    if (!record) throw new InvalidVerificationCodeError("验证码错误或已过期");

    await this.users.updatePhone(String(userId), input.phone);
    await this.authCodes.markCodeUsed(record.id);
  }

  async resolveAccountFlags(userId: string | number): Promise<AccountFlags | null> {
    const user = await this.users.findById(String(userId));
    return user
      ? {
          phone: user.phone,
          hasPassword: user.password !== null,
          mustChangePassword: user.mustChangePassword,
        }
      : null;
  }

  async changePassword(
    userId: string | number,
    input: { oldPassword?: string | undefined; newPassword: string },
  ): Promise<boolean> {
    const user = await this.users.findById(String(userId));
    if (!user) {
      throw new InvalidCredentialsError();
    }
    if (user.password !== null) {
      if (!input.oldPassword || !(await verifyPassword(input.oldPassword, user.password))) {
        throw new InvalidCredentialsError();
      }
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.users.updatePassword(String(userId), passwordHash, false);
    return user.mustChangePassword;
  }

  async resetPassword(userId: string | number, newPassword: string): Promise<void> {
    const user = await this.users.findById(String(userId));
    if (!user) {
      throw new InvalidCredentialsError();
    }
    const passwordHash = await hashPassword(newPassword);
    await this.users.updatePassword(String(userId), passwordHash, true);
  }

  async listAdminUsers(options: AdminUserListOptions) {
    return this.adminUsers.listAdminUsers(options);
  }

  async countAdminUsers(): Promise<number> {
    return this.adminUsers.countAdminUsers();
  }

  async findAdminUserIdByKeyword(keyword: string) {
    return this.adminUsers.findUserIdByKeyword(keyword);
  }

  async loadAdminUserIdentities(userIds: readonly number[]) {
    return this.adminUsers.loadUserIdentities(userIds);
  }

  async setUserStatus(
    userId: string | number,
    status: IdentityUserStatus,
  ): Promise<boolean> {
    return this.users.updateStatus(String(userId), status);
  }

  async listRoleCodes(userId: string | number): Promise<string[]> {
    return this.roles.listRoleCodes(String(userId));
  }

  async userExists(userId: string | number): Promise<boolean> {
    return (await this.users.findById(String(userId))) !== null;
  }

  async isAdmin(userId: string | number): Promise<boolean> {
    return this.roles.isAdmin(String(userId));
  }

  async resolveAccessState(
    userId: string | number,
  ): Promise<{ role: number; status: number }> {
    const user = await this.users.findById(String(userId));
    if (!user) return { role: roleRank([]), status: 0 };
    return {
      role: roleRank(await this.roles.listRoleCodes(user.id)),
      status: user.status === USER_STATUS_NORMAL ? 1 : 0,
    };
  }

  async grantRole(userId: string | number, code: string, grantedBy: string): Promise<void> {
    await this.roles.grant(String(userId), code, grantedBy);
  }

  async revokeRole(userId: string | number, code: string): Promise<void> {
    const targetRoles = await this.roles.listRoleCodes(String(userId));
    if (revokeWouldOrphanSuperAdmin(code, targetRoles, await this.roles.countHolders(ROLE_SUPER_ADMIN))) {
      throw new LastSuperAdminError();
    }
    await this.roles.revoke(String(userId), code);
  }

  async recordLogin(entry: {
    userId?: string | null | undefined;
    username: string;
    ip: string;
    userAgent: string;
    success: boolean;
    reason?: string | undefined;
  }): Promise<void> {
    await this.loginLogs.record(entry);
  }

  async resolveTier(userId: string | number, now: Date = new Date()): Promise<Tier> {
    const resolution = await this.memberships.resolveTier(String(userId), now);

    if (resolution.unknownTiers.length > 0) {
      this.logger.error(
        `用户 ${userId} 的会员周期含认不出的等级 [${resolution.unknownTiers.join(", ")}]，` +
          `本次按 ${resolution.tier} 处理（该用户此刻可能被少给权益）`,
      );
    }

    return resolution.tier;
  }
}
