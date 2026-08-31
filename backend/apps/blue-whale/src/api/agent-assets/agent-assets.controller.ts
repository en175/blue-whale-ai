import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { fail, ok } from "@blue-whale/contracts";
import { assetDurationSeconds } from "@blue-whale/persistence";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import {
  handleCompleteAsset,
  handlePresignAsset,
  type CompleteAssetInput,
  type PresignAssetInput,
} from "@lib/shared/assets/upload.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("agent/assets")
export class AgentAssetsController {
  constructor(
    private readonly assets: AssetService,
    private readonly projects: ProjectService,
    private readonly storage: AssetStorageService,
  ) {}

  @Post("presign")
  async presign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PresignAssetInput,
  ) {
    return handlePresignAsset(user.userId, body, this.storage.uploads);
  }

  @Post("uploads/presign")
  async uploadsPresign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PresignAssetInput,
  ) {
    return handlePresignAsset(user.userId, body, this.storage.uploads);
  }

  @Post("uploads/complete")
  async uploadsComplete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CompleteAssetInput,
  ) {
    return handleCompleteAsset(user.userId, body, {
      projects: this.projects,
      uploads: this.assets,
      storage: this.storage.uploads,
    });
  }

  @Post(":assetId/complete")
  async completeDeprecated() {
    throw new NewApiError("请改用 /api/agent/assets/uploads/complete", 410);
  }

  @Get(":assetId")
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("assetId") assetId: string,
  ) {
    const asset = await this.assets.findOwnedSource(assetId, user.userId);
    if (!asset) return fail(100301, "资源不存在");
    return ok({
      asset_id: assetId,
      status: "ready" as const,
      type: asset.type,
      url: asset.url,
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      duration: assetDurationSeconds(asset.duration_ms),
      mime: asset.mime ?? "application/octet-stream",
      size: Number(asset.size ?? BigInt(0)),
    });
  }
}
