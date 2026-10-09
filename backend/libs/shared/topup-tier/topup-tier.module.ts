import { Global, Module } from "@nestjs/common";
import { createTopupTierRepo } from "@lib/shared/persistence/index.js";
import { PrismaModule } from "@lib/shared/prisma/prisma.module.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { TierAuditService } from "./tier-audit.service.js";
import { TOPUP_TIER_REPO_TOKEN } from "./topup-tier.tokens.js";

@Global()
@Module({
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
