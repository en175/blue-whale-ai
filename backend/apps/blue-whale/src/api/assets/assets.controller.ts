import { Controller, Delete, Get, Param, Query } from "@nestjs/common";
import { fail, ok } from "@lib/contracts";
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

  /** 单个资产详情（画布/资产库弹窗用）：命中返回 AssetDetailView（列表字段 + 生成提示词，
   *  IKFSSO），不归属/不存在 → 100301。 */
  @Get(":assetId")
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("assetId") assetId: string,
  ) {
    const asset = await this.assets.findOwnedById(assetId, user.userId);
    return asset ? ok(asset) : fail(100301, "资源不存在");
  }

  /** IKCZAT：查询素材被多少项目引用（直接归属 ∪ project_asset 并集去重）。只读，不改删除行为。 */
  @Get(":assetId/references")
  async getReferences(
    @CurrentUser() user: AuthenticatedUser,
    @Param("assetId") assetId: string,
  ) {
    const asset = await this.assets.findOwnedById(assetId, user.userId);
    if (!asset) return fail(100301, "资源不存在");
    const projectCount = await this.assets.countReferencingProjects(
      assetId,
      user.userId,
    );
    return ok({ assetId, projectCount });
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
