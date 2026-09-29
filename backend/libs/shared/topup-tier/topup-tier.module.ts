import { Global, Module } from "@nestjs/common";
import { createTopupTierRepo } from "@lib/shared/persistence/index.js";
import { PrismaModule } from "@lib/shared/prisma/prisma.module.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { TierAuditService } from "./tier-audit.service.js";
import { TOPUP_TIER_REPO_TOKEN } from "./topup-tier.tokens.js";

/**
 * 档位域装配。
 *
 * <p>此前这里还导出过一个 `TopupTierService` 壳：7 个方法全是 `return this.repo.xxx(...)`，
 * interface 与 `TopupTierRepo` 一样宽、implementation 只有一句惰性初始化 —— 调用方白学一层
 * 无信息的 interface。壳删除后复杂度不会重现：本模块直接把 repo 做成 provider。
 *
 * <p>token 定义在同目录的 `topup-tier.tokens.ts`，不在这里 —— 见那边的注释。
 */
@Global()
@Module({
  // `PrismaService` 靠 `PrismaModule` 是 @Global 也能解析，但显式写上让本模块
  // **可独立启动**（不依赖 AppModule 恰好先导入了什么）—— 同 `cost-settlement.module.ts`。
  imports: [PrismaModule],
  providers: [
    {
      provide: TOPUP_TIER_REPO_TOKEN,
      useFactory: (prisma: PrismaService) => createTopupTierRepo(prisma.client),
      inject: [PrismaService],
    },
    TierAuditService,
  ],
  exports: [TOPUP_TIER_REPO_TOKEN, TierAuditService],
})
export class TopupTierModule {}
