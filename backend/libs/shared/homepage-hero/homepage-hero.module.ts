import { Global, Module } from "@nestjs/common";
import { HomepageHeroAuditService } from "./homepage-hero-audit.service.js";
import { HomepageHeroService } from "./homepage-hero.service.js";

/** 首页背景图/视频后台动态配置（IKCH05）：全局共享 service/audit，admin + 公开读取共用。 */
@Global()
@Module({
  providers: [HomepageHeroService, HomepageHeroAuditService],
  exports: [HomepageHeroService, HomepageHeroAuditService],
})
export class HomepageHeroModule {}
