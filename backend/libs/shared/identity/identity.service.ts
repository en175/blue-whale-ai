import { Injectable } from "@nestjs/common";

import {
  LEGACY_VERIFICATION_PURPOSE,
  type VerificationPurpose,
} from "@lib/contracts";
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
import { normalizeNickname } from "@lib/core";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

export interface LocalLoginResult {
  userId: number;
  username: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  hasPassword: boolean;
  mustChangePassword: boolean;
  role: number;
  status: number;
}

export interface AccountFlags {
  phone: string | null;
  nickname: string | null;
  hasPassword: boolean;
  mustChangePassword: boolean;
}

const MAX_CODE_ATTEMPTS = 5;

export class CodeExpiredError extends Error {
  constructor() {
    super("验证码已失效，请重新获取");
    this.name = "CodeExpiredError";
  }
}

export class CodeWrongError extends Error {
  constructor(readonly remaining: number) {
    super("验证码错误，请重新输入");
    this.name = "CodeWrongError";
  }
}

export class CodeAttemptsExhaustedError extends Error {
  constructor() {
    super("验证码连续错误5次，已失效，请重新获取");
    this.name = "CodeAttemptsExhaustedError";
  }
}

export class AccountDisabledError extends Error {
  constructor() {
    super("账号已停用");
    this.name = "AccountDisabledError";
  }
}

export class AccountDeletedError extends Error {
  constructor() {
    super("该手机号关联的账号已删除，暂无法登录");
    this.name = "AccountDeletedError";
  }
}

export class PhoneNotBoundError extends Error {
  constructor() {
    super("当前账号尚未绑定手机号");
    this.name = "PhoneNotBoundError";
  }
}

export class RebindSamePhoneError extends Error {
  constructor() {
    super("新手机号与当前手机号相同，无需更换");
    this.name = "RebindSamePhoneError";
  }
}

export class RebindBindingChangedError extends Error {
  constructor() {
    super("账号绑定状态已变化，请重新登录");
    this.name = "RebindBindingChangedError";
  }
}

export class MigrationIneligibleError extends Error {
  constructor() {
    super("账号或密码不正确，或当前账号不可迁移");
    this.name = "MigrationIneligibleError";
  }
}

export class NicknameInvalidError extends Error {
  constructor() {
    super(
      "昵称需为2—20个字符，仅支持中文、英文大小写字母、数字、下划线（_）和短横线（-）",
    );
    this.name = "NicknameInvalidError";
  }
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
      nickname: user.nickname,
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

  private async validatePhoneCode(
    phone: string,
    purposes: readonly string[],
    code: string,
  ): Promise<string> {
    const record = await this.authCodes.findActiveCode(phone, purposes);
    if (!record) {
      throw new CodeExpiredError();
    }
    if (record.code !== code) {
      const attempts = await this.authCodes.incrementAttempts(record.id);
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await this.authCodes.consumeCode(record.id);
        throw new CodeAttemptsExhaustedError();
      }
      throw new CodeWrongError(MAX_CODE_ATTEMPTS - attempts);
    }
    return record.id;
  }

  private async consumePhoneCode(codeId: string): Promise<void> {
    if (!(await this.authCodes.consumeCode(codeId))) {
      throw new CodeExpiredError();
    }
  }

  async loginWithPhoneCode(input: {
    phone: string;
    code: string;
    purpose?: VerificationPurpose;
  }): Promise<{ result: LocalLoginResult; isNewUser: boolean }> {
    const purpose = input.purpose ?? "login";
    const codeId = await this.validatePhoneCode(
      input.phone,
      [purpose, LEGACY_VERIFICATION_PURPOSE],
      input.code,
    );

    await this.assertPhoneAccountUsable(input.phone);
    await this.consumePhoneCode(codeId);

    const user = await this.authCodes.upsertUser(input.phone);
    if (user.isDelete) throw new AccountDeletedError();
    if (user.status !== USER_STATUS_NORMAL) throw new AccountDisabledError();

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
      throw new AccountDeletedError();
    }

    return { result: await this.toLoginResult(row), isNewUser: user.created };
  }

  private async assertPhoneAccountUsable(phone: string): Promise<void> {
    const existing = await this.authCodes.findByPhone(phone);
    if (!existing) return;
    if (existing.isDelete) throw new AccountDeletedError();
    if (existing.status !== USER_STATUS_NORMAL) throw new AccountDisabledError();
  }

  async bindPhone(
    userId: string | number,
    input: { phone: string; code: string },
  ): Promise<void> {
    const self = await this.users.findById(String(userId));
    if (!self) throw new InvalidCredentialsError();
    if (self.phone) throw new PhoneAlreadyBoundError();

    const codeId = await this.validatePhoneCode(
      input.phone,
      ["bind", LEGACY_VERIFICATION_PURPOSE],
      input.code,
    );
    await this.consumePhoneCode(codeId);
    await this.users.updatePhone(String(userId), input.phone);
  }

  async rebindVerifyCurrent(userId: string | number, code: string): Promise<{ oldPhone: string }> {
    const self = await this.users.findById(String(userId));
    if (!self) throw new InvalidCredentialsError();
    if (!self.phone) throw new PhoneNotBoundError();

    const codeId = await this.validatePhoneCode(self.phone, ["rebind_old"], code);
    await this.consumePhoneCode(codeId);
    return { oldPhone: self.phone };
  }

  async commitRebind(
    userId: string | number,
    input: { oldPhone: string; phone: string; code: string },
  ): Promise<{ phone: string }> {
    const self = await this.users.findById(String(userId));
    if (!self) throw new InvalidCredentialsError();
    if (self.phone !== input.oldPhone) throw new RebindBindingChangedError();
    if (self.phone === input.phone) throw new RebindSamePhoneError();

    const codeId = await this.validatePhoneCode(input.phone, ["rebind_new"], input.code);
    await this.consumePhoneCode(codeId);
    await this.users.updatePhone(String(userId), input.phone);
    return { phone: input.phone };
  }

  async verifyMigrationCandidate(input: {
    username: string;
    password: string;
  }): Promise<{ userId: string }> {
    const user = await this.users.findByLoginName(input.username);
    if (!user || user.password === null) {
      await burnVerificationTime(input.password);
      throw new InvalidCredentialsError();
    }
    if (!(await verifyPassword(input.password, user.password))) {
      throw new InvalidCredentialsError();
    }
    if (user.phone !== null || user.status !== USER_STATUS_NORMAL) {
      throw new MigrationIneligibleError();
    }
    return { userId: user.id };
  }

  async commitMigrationBind(
    userId: string | number,
    input: { phone: string; code: string },
  ): Promise<IdentityUserRow> {
    const self = await this.users.findById(String(userId));
    if (!self) throw new MigrationIneligibleError();
    if (self.phone !== null || self.status !== USER_STATUS_NORMAL) {
      throw new MigrationIneligibleError();
    }
    const codeId = await this.validatePhoneCode(
      input.phone,
      ["bind", LEGACY_VERIFICATION_PURPOSE],
      input.code,
    );
    await this.consumePhoneCode(codeId);
    await this.users.updatePhone(String(userId), input.phone);
    const updated = await this.users.findById(String(userId));
    if (!updated) throw new MigrationIneligibleError();
    return updated;
  }

  async getLoginResult(userId: string | number): Promise<LocalLoginResult> {
    const row = await this.users.findById(String(userId));
    if (!row) throw new InvalidCredentialsError();
    return this.toLoginResult(row);
  }

  async updateNickname(
    userId: string | number,
    raw: unknown,
  ): Promise<{ nickname: string; changed: boolean }> {
    const parsed = normalizeNickname(raw);
    if (!parsed.ok) throw new NicknameInvalidError();
    const self = await this.users.findById(String(userId));
    if (!self) throw new InvalidCredentialsError();
    if (self.nickname === parsed.value) {
      return { nickname: parsed.value, changed: false };
    }
    await this.users.updateNickname(String(userId), parsed.value);
    return { nickname: parsed.value, changed: true };
  }

  async resolveAccountFlags(userId: string | number): Promise<AccountFlags | null> {
    const user = await this.users.findById(String(userId));
    return user
      ? {
          phone: user.phone,
          nickname: user.nickname,
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
