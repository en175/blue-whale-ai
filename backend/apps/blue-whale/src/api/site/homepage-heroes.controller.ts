import { Controller, Get } from "@nestjs/common";
import { ok } from "@lib/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { HomepageHeroService } from "@lib/shared/homepage-hero/homepage-hero.service.js";

@Controller("site/homepage-heroes")
export class SiteHomepageHeroesController {
  constructor(private readonly hero: HomepageHeroService) {}

  @Public()
  @Get()
  async list() {
    return ok(await this.hero.listEnabled());
  }
}
