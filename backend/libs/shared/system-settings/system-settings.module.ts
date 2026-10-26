import { Global, Module } from "@nestjs/common";
import { SystemSettingsService } from "./system-settings.service.js";

@Global()
@Module({
  providers: [SystemSettingsService],
  exports: [SystemSettingsService],
})
export class SystemSettingsModule {}
