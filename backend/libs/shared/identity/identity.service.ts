import { Injectable } from "@nestjs/common";

import type { Tier } from "@lib/core/identity/tier.js";
import { createLogger } from "@lib/core/logging";
import { createIdentityMembershipRepo } from "@lib/shared/persistence/identity-membership-repo.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/**
 * 用户身份域的对内入口 —— 目前只回答一个问题：**这个用户现在是什么等级**。
 *
 * <h2>为什么这一层存在，而不是让调用方直接用 repo</h2>
 *
 * 「认不出的等级」必须被看见。repo 与纯函数都刻意把脏值**原样往上报**而不自己记日志
 * （纯函数不该有副作用），汇聚与留痕放在这里——一处收敛，所有调用方自动获得可观测性。
 *
 * <p>反过来，如果每个调用方各自处理，就会出现「有的地方记了、有的地方吞了」，
 * 而吞掉的那一处正是用户投诉「我升了级却没打折」时最难查的。
 */
@Injectable()
export class IdentityService {
  private readonly logger = createLogger("identity");
  private readonly memberships;

  constructor(prisma: PrismaService) {
    this.memberships = createIdentityMembershipRepo(prisma.client);
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
