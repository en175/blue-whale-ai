import { Global, Module } from "@nestjs/common";
import { MediaToolBillingService } from "./media-tool-billing.service.js";
import { MediaToolPricingAdminService } from "./media-tool-pricing-admin.service.js";

@Global()
@Module({
  providers: [MediaToolPricingAdminService, MediaToolBillingService],
  exports: [MediaToolPricingAdminService, MediaToolBillingService],
})
export class MediaToolPricingAdminModule {}
