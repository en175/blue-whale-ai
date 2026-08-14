import { Controller, Delete, Get, Param, Query } from "@nestjs/common";
import { fail, ok } from "@blue-whale/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("assets")
export class AssetsController {
  constructor(private readonly assets: AssetService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const filter: { type?: string; page: number; size: number } = {
      page: Math.max(1, Number(query.page ?? "1") || 1),
      size: Math.max(1, Number(query.size ?? "24") || 24),
    };
    if (query.type) filter.type = query.type;
    return ok(await this.assets.listByUser(user.userId, filter));
  }

  @Delete(":assetId")
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("assetId") assetId: string,
  ) {
    const deleted = await this.assets.softDeleteOwned(assetId, user.userId);
    return deleted ? ok(null) : fail(100301, "资源不存在");
  }
}
