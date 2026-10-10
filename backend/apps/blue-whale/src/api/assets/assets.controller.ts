import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { fail, ok } from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("assets")
export class AssetsController {
  constructor(
    private readonly assets: AssetService,
    private readonly material: MaterialService,
  ) {}

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

  @Post("library-materials")
  async listLibraryMaterials(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const data = await this.material.listLibraryAssets({
      userId: user.userId,
      body,
    });
    return ok(data);
  }

  @Get(":assetId")
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("assetId") assetId: string,
  ) {
    const asset = await this.assets.findOwnedById(assetId, user.userId);
    return asset ? ok(asset) : fail(100301, "资源不存在");
  }

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
    const asset = await this.assets.findOwnedById(assetId, user.userId);
    if (!asset) return fail(100301, "资源不存在");
    if (asset.material_id) {
      await this.material.cascadeDeleteUpstreamMaterial({
        userId: user.userId,
        materialId: asset.material_id,
      });
    }
    const deleted = await this.assets.softDeleteOwned(assetId, user.userId);
    return deleted ? ok(null) : fail(100301, "资源不存在");
  }
}
