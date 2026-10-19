import { Global, Module } from "@nestjs/common";
import { MediaToolPricingAdminService } from "./media-tool-pricing-admin.service.js";

@Global()
@Module({
  providers: [MediaToolPricingAdminService],
  exports: [MediaToolPricingAdminService],
})
export class MediaToolPricingAdminModule {}
