import { Global, Module } from "@nestjs/common";
import { TierAuditService } from "./tier-audit.service.js";
import { TopupTierService } from "./topup-tier.service.js";

@Global()
@Module({
  providers: [TopupTierService, TierAuditService],
  exports: [TopupTierService, TierAuditService],
})
export class TopupTierModule {}
