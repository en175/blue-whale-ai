import { Controller, Get } from "@nestjs/common";
import { ok } from "@blue-whale/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { HomepageHeroService } from "@lib/shared/homepage-hero/homepage-hero.service.js";

/**
 * 首页背景图/视频公开读取（IKCH05，接口对齐母工单 IKCH01 草稿）。
 * 无鉴权；只暴露 { id, media_type, media_url, poster_url, sort_order }（不带 enabled）。
 * 空列表返回 []（200）。
 */
@Controller("site/homepage-heroes")
export class SiteHomepageHeroesController {
  constructor(private readonly hero: HomepageHeroService) {}

  @Public()
  @Get()
  async list() {
    return ok(await this.hero.listEnabled());
  }
}
