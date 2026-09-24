import { Injectable } from "@nestjs/common";

import type { Tier } from "@lib/core/identity/tier.js";
import { createLogger } from "@lib/core/logging";
import { createIdentityLoginLogRepo } from "@lib/shared/persistence/identity-login-log-repo.js";
import { createIdentityMembershipRepo } from "@lib/shared/persistence/identity-membership-repo.js";
import { createIdentityRoleRepo } from "@lib/shared/persistence/identity-role-repo.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/**
 * 用户身份域的对内入口 —— 三件事：**等级（花多少钱）、角色（能做什么）、登录留痕**。
 *
 * <h2>为什么这一层存在，而不是让调用方直接用 repo</h2>
 *
 * 「认不出的等级」必须被看见。repo 与纯函数都刻意把脏值**原样往上报**而不自己记日志
 * （纯函数不该有副作用），汇聚与留痕放在这里——一处收敛，所有调用方自动获得可观测性。
 *
 * <p>反过来，如果每个调用方各自处理，就会出现「有的地方记了、有的地方吞了」，
 * 而吞掉的那一处正是用户投诉「我升了级却没打折」时最难查的。
 *
 * <p>⚠️ 等级与角色是**两回事**，见 {@code @lib/core/identity/roles.ts}：
 * 一个决定折扣，一个决定权限。这里放在一起只是因为它们同属身份域。
 */
@Injectable()
export class IdentityService {
  private readonly logger = createLogger("identity");
  private readonly memberships;
  private readonly roles;
  private readonly loginLogs;

  constructor(prisma: PrismaService) {
    this.memberships = createIdentityMembershipRepo(prisma.client);
    this.roles = createIdentityRoleRepo(prisma.client);
    this.loginLogs = createIdentityLoginLogRepo(prisma.client);
  }

  /** 该用户持有的角色 code（已排除软删的角色行）。 */
  async listRoleCodes(userId: string | number): Promise<string[]> {
    return this.roles.listRoleCodes(String(userId));
  }

  /** 是否具备管理员权限（持有 admin / super_admin 中任意一个）。 */
  async isAdmin(userId: string | number): Promise<boolean> {
    return this.roles.isAdmin(String(userId));
  }

  /**
   * 记一条登录日志。
   *
   * <p>⚠️ **写失败不阻断登录**——日志是旁路。但调用方要 catch 并记 error，
   * 别让它静默消失：一个坏掉的日志表不该表现为「一切正常」。
   */
  async recordLogin(entry: {
    // ⚠️ 可选属性显式带 `| undefined`：本仓开了 `exactOptionalPropertyTypes`，
    //    不加的话调用方传一个可能为 undefined 的值（如未取的 @Headers）就编译不过。
    userId?: string | null | undefined;
    username: string;
    ip: string;
    userAgent: string;
    success: boolean;
    reason?: string | undefined;
  }): Promise<void> {
    await this.loginLogs.record(entry);
  }

  /**
   * 用户的当前会员等级；无有效会员时返回 `free`。
   *
   * @param now 判定时刻。默认取当前时间，**测试与批处理应显式传入**——
   *            同一批处理里的「现在」必须是一个值。
   */
  async resolveTier(userId: string | number, now: Date = new Date()): Promise<Tier> {
    const resolution = await this.memberships.resolveTier(String(userId), now);

    if (resolution.unknownTiers.length > 0) {
      // 不静默：此刻这个用户正被当成 free，而根源是库里的脏数据。
      // 等级是计费折扣的输入，少给权益与多给钱都要有人知道。
      this.logger.error(
        `用户 ${userId} 的会员周期含认不出的等级 [${resolution.unknownTiers.join(", ")}]，` +
          `本次按 ${resolution.tier} 处理（该用户此刻可能被少给权益）`,
      );
    }

    return resolution.tier;
  }
}
