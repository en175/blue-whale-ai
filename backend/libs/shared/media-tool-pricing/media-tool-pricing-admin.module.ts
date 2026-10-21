import { Global, Module } from "@nestjs/common";
import { MediaToolBillingService } from "./media-tool-billing.service.js";
import { MediaToolPricingAdminService } from "./media-tool-pricing-admin.service.js";
import { MediaToolQuoteService } from "./media-tool-quote.service.js";

@Global()
@Module({
  providers: [
    MediaToolPricingAdminService,
    MediaToolBillingService,
    MediaToolQuoteService,
  ],
  exports: [
    MediaToolPricingAdminService,
    MediaToolBillingService,
    MediaToolQuoteService,
  ],
})
export class MediaToolPricingAdminModule {}
