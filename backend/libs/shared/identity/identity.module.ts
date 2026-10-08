import { Global, Module } from "@nestjs/common";

import { IdentityService } from "./identity.service.js";

@Global()
@Module({
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
