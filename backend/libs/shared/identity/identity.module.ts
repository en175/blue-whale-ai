import { Global, Module } from "@nestjs/common";

import { AccountDirectoryService } from "./account-directory.service.js";
import { IdentityService } from "./identity.service.js";
import { PhoneBindingService } from "./phone-binding.service.js";

@Global()
@Module({
  providers: [IdentityService, PhoneBindingService, AccountDirectoryService],
  exports: [IdentityService, PhoneBindingService, AccountDirectoryService],
})
export class IdentityModule {}
