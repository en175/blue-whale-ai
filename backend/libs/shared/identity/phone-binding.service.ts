import { Injectable } from "@nestjs/common";

import {
  LEGACY_VERIFICATION_PURPOSE,
  type VerificationPurpose,
} from "@lib/contracts";
import { roleRank, ROLE_USER } from "@lib/core/identity/roles.js";
import { createLogger } from "@lib/core/logging";
import { createIdentityRoleRepo } from "@lib/shared/persistence/identity-role-repo.js";
import {
  createIdentityUserRepo,
  USER_STATUS_NORMAL,
  type IdentityUserRow,
} from "@lib/shared/persistence/identity-user-repo.js";
import { PhoneVerificationService } from "@lib/shared/auth/phone-verification.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { burnVerificationTime, verifyPassword } from "./password.js";
import {
  AccountDeletedError,
  AccountDisabledError,
  InvalidCredentialsError,
  MigrationIneligibleError,
  PhoneAlreadyBoundError,
  PhoneNotBoundError,
  RebindBindingChangedError,
  RebindSamePhoneError,
  type LocalLoginResult,
} from "./identity.service.js";

function hasBoundPhone(phone: string | null | undefined): boolean {
  return typeof phone === "string" && phone.trim().length > 0;
}

@Injectable()
export class PhoneBindingService {
  private readonly logger = createLogger("phone-binding");
  private readonly users;
  private readonly roles;

  constructor(
    prisma: PrismaService,
    private readonly verification: PhoneVerificationService,
  ) {
    this.users = createIdentityUserRepo(prisma.client);
    this.roles = createIdentityRoleRepo(prisma.client);
  }

  private async toLoginResult(user: IdentityUserRow): Promise<LocalLoginResult> {
    return {
      userId: Number(user.id),
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      phone: user.phone,
      hasPassword: user.password !== null,
      role: roleRank(await this.roles.listRoleCodes(user.id)),
      status: user.status === USER_STATUS_NORMAL ? 1 : 0,
    };
  }

  private async assertPhoneAccountUsable(phone: string): Promise<void> {
    const existing = await this.users.findByPhoneIncludingDeleted(phone);
    if (!existing) return;
    if (existing.deleted) throw new AccountDeletedError();
    if (existing.user.status !== USER_STATUS_NORMAL) {
      throw new AccountDisabledError();
    }
  }

  async loginWithPhoneCode(input: {
    phone: string;
    code: string;
    purpose?: VerificationPurpose;
  }): Promise<{ result: LocalLoginResult; isNewUser: boolean }> {
    const purpose = input.purpose ?? "login";
    const verified = await this.verification.verify({
      phone: input.phone,
      code: input.code,
      purposes: [purpose, LEGACY_VERIFICATION_PURPOSE],
    });

    await this.assertPhoneAccountUsable(input.phone);
    await this.verification.consume(verified);

    const account = await this.users.upsertPhone(input.phone);
    if (account.deleted) throw new AccountDeletedError();
    if (account.user.status !== USER_STATUS_NORMAL) {
      throw new AccountDisabledError();
    }

    if (account.created) {
      try {
        await this.roles.grant(account.user.id, ROLE_USER, "phone-register");
      } catch (error) {
        this.logger.error(
          `手机号建号后授予 ${ROLE_USER} 角色失败（用户 ${account.user.id}）：` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      result: await this.toLoginResult(account.user),
      isNewUser: account.created,
    };
  }

  async bindPhone(
    userId: string | number,
    input: { phone: string; code: string },
  ): Promise<void> {
    const self = await this.users.findById(String(userId));
    if (!self) throw new InvalidCredentialsError();
    if (hasBoundPhone(self.phone)) throw new PhoneAlreadyBoundError();

    const verified = await this.verification.verify({
      phone: input.phone,
      code: input.code,
      purposes: ["bind", LEGACY_VERIFICATION_PURPOSE],
    });
    await this.verification.consume(verified);
    await this.users.updatePhone(String(userId), input.phone);
  }

  async rebindVerifyCurrent(
    userId: string | number,
    code: string,
  ): Promise<{ oldPhone: string }> {
    const self = await this.users.findById(String(userId));
    if (!self) throw new InvalidCredentialsError();
    if (!hasBoundPhone(self.phone)) throw new PhoneNotBoundError();
    const oldPhone = (self.phone ?? "").trim();

    const verified = await this.verification.verify({
      phone: oldPhone,
      code,
      purposes: ["rebind_old"],
    });
    await this.verification.consume(verified);
    return { oldPhone };
  }

  async commitRebind(
    userId: string | number,
    input: { oldPhone: string; phone: string; code: string },
  ): Promise<{ phone: string }> {
    const self = await this.users.findById(String(userId));
    if (!self) throw new InvalidCredentialsError();
    const currentPhone = (self.phone ?? "").trim();
    if (currentPhone !== input.oldPhone) throw new RebindBindingChangedError();
    if (currentPhone === input.phone) throw new RebindSamePhoneError();

    const verified = await this.verification.verify({
      phone: input.phone,
      code: input.code,
      purposes: ["rebind_new"],
    });
    const updated = await this.users.rebindPhoneIfCurrent(
      String(userId),
      currentPhone,
      input.phone,
    );
    if (!updated) throw new RebindBindingChangedError();
    await this.verification.consume(verified);
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
    if (hasBoundPhone(user.phone)) {
      throw new MigrationIneligibleError(
        "该账号已绑定手机号，请直接使用手机号登录",
      );
    }
    if (user.status !== USER_STATUS_NORMAL) {
      throw new MigrationIneligibleError("账号已停用，无法迁移");
    }
    return { userId: user.id };
  }

  async commitMigrationBind(
    userId: string | number,
    input: { phone: string; code: string },
  ): Promise<IdentityUserRow> {
    const self = await this.users.findById(String(userId));
    if (!self) throw new MigrationIneligibleError();
    if (hasBoundPhone(self.phone)) {
      throw new MigrationIneligibleError(
        "该账号已绑定手机号，请直接使用手机号登录",
      );
    }
    if (self.status !== USER_STATUS_NORMAL) {
      throw new MigrationIneligibleError("账号已停用，无法迁移");
    }
    const verified = await this.verification.verify({
      phone: input.phone,
      code: input.code,
      purposes: ["bind", LEGACY_VERIFICATION_PURPOSE],
    });
    const updated = await this.users.bindPhoneIfUnbound(
      String(userId),
      input.phone,
    );
    if (!updated) {
      throw new MigrationIneligibleError("账号绑定状态已变化，请重新登录");
    }
    await this.verification.consume(verified);
    const bound = await this.users.findById(String(userId));
    if (!bound) throw new MigrationIneligibleError();
    return bound;
  }
}
