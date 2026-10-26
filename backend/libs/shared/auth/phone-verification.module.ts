import { Global, Module } from "@nestjs/common";

import { PhoneVerificationService } from "./phone-verification.service.js";

@Global()
@Module({
  providers: [PhoneVerificationService],
  exports: [PhoneVerificationService],
})
export class PhoneVerificationModule {}
