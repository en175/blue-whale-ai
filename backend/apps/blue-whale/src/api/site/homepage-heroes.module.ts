import { Module } from "@nestjs/common";
import { SiteHomepageHeroesController } from "./homepage-heroes.controller.js";

/** 首页背景图/视频公开读取模块（IKCH05）。 */
@Module({
  controllers: [SiteHomepageHeroesController],
})
export class SiteHomepageHeroesModule {}
