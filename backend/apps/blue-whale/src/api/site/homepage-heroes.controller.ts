import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { ok } from "@lib/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { HomepageHeroService } from "@lib/shared/homepage-hero/homepage-hero.service.js";
import { parseHomepageHeroScene } from "@lib/shared/homepage-hero/homepage-hero-validation.js";

@Controller("site/homepage-heroes")
export class SiteHomepageHeroesController {
  constructor(private readonly hero: HomepageHeroService) {}

  @Public()
  @Get()
  async list(@Query("scene") sceneRaw?: string) {
    const scene = parseHomepageHeroScene(sceneRaw);
    if (!scene) throw new BadRequestException("scene 仅支持 homepage/auth");
    return ok(await this.hero.listEnabled(scene));
  }
}
