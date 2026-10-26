import { Global, Module } from "@nestjs/common";
import { HomepageHeroAuditService } from "./homepage-hero-audit.service.js";
import { HomepageHeroService } from "./homepage-hero.service.js";

@Global()
@Module({
  providers: [HomepageHeroService, HomepageHeroAuditService],
  exports: [HomepageHeroService, HomepageHeroAuditService],
})
export class HomepageHeroModule {}
