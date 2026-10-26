import { Injectable } from "@nestjs/common";

import {
  LastSuperAdminError,
  revokeWouldOrphanSuperAdmin,
  roleRank,
  ROLE_SUPER_ADMIN,
} from "@lib/core/identity/roles.js";
import type { Tier } from "@lib/core/identity/tier.js";
import { createLogger } from "@lib/core/logging";
import { createAdminUserQuery, type AdminUserListOptions } from "@lib/shared/persistence/admin-user-query.js";
import { createIdentityLoginLogRepo } from "@lib/shared/persistence/identity-login-log-repo.js";
import { createIdentityMembershipRepo } from "@lib/shared/persistence/identity-membership-repo.js";
import { createIdentityRoleRepo } from "@lib/shared/persistence/identity-role-repo.js";
import {
  createIdentityUserRepo,
  USER_STATUS_NORMAL,
  type IdentityUserStatus,
} from "@lib/shared/persistence/identity-user-repo.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

@Injectable()
export class AccountDirectoryService {
  private readonly logger = createLogger("identity-directory");
  private readonly memberships;
  private readonly roles;
  private readonly loginLogs;
  private readonly adminUsers;
  private readonly users;

  constructor(prisma: PrismaService) {
    this.memberships = createIdentityMembershipRepo(prisma.client);
    this.roles = createIdentityRoleRepo(prisma.client);
    this.loginLogs = createIdentityLoginLogRepo(prisma.client);
    this.adminUsers = createAdminUserQuery(prisma.client);
    this.users = createIdentityUserRepo(prisma.client);
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
    if (
      revokeWouldOrphanSuperAdmin(
        code,
        targetRoles,
        await this.roles.countHolders(ROLE_SUPER_ADMIN),
      )
    ) {
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
