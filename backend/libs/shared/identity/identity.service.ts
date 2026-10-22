import { Injectable } from "@nestjs/common";

import {
  roleRank,
  ROLE_USER,
} from "@lib/core/identity/roles.js";
import { createLogger } from "@lib/core/logging";
import { createIdentityRoleRepo } from "@lib/shared/persistence/identity-role-repo.js";
import {
  createIdentityUserRepo,
  USER_STATUS_NORMAL,
  type IdentityUserRow,
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

export {
  CodeAttemptsExhaustedError,
  CodeExpiredError,
  CodeWrongError,
} from "@lib/shared/auth/phone-verification.service.js";

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
  constructor(message = "账号或密码不正确，或当前账号不可迁移") {
    super(message);
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
  private readonly roles;
  private readonly users;

  constructor(prisma: PrismaService) {
    this.roles = createIdentityRoleRepo(prisma.client);
    this.users = createIdentityUserRepo(prisma.client);
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

}
