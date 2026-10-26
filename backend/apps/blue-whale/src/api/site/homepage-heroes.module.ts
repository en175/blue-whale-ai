import { Module } from "@nestjs/common";
import { SiteHomepageHeroesController } from "./homepage-heroes.controller.js";

@Module({
  controllers: [SiteHomepageHeroesController],
})
export class SiteHomepageHeroesModule {}
