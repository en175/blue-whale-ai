import { Global, Module } from "@nestjs/common";
import { SystemSettingsService } from "./system-settings.service.js";

/** 系统设置是全局依赖：管理端页面与充值下单都要读它。 */
@Global()
@Module({
  providers: [SystemSettingsService],
  exports: [SystemSettingsService],
})
export class SystemSettingsModule {}
