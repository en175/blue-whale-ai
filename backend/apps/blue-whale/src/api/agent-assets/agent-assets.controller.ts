import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { DomainError, RESOURCE_NOT_FOUND_CODE, ok } from "@lib/contracts";
import { assetDurationSeconds } from "@lib/shared/persistence/index.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import {
  handleCompleteAsset,
  handleDedupAsset,
  handlePresignAsset,
  type CompleteAssetInput,
  type DedupAssetInput,
  type PresignAssetInput,
} from "@lib/shared/assets/upload.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import {
  RateLimit,
  type RateLimitBucket,
} from "@lib/shared/rate-limit/decorators/rate-limit.decorator.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const ASSET_PRESIGN_BUCKETS: RateLimitBucket[] = [
  { scope: "asset-presign", key: "user", limit: 30, windowMs: 60_000 },
  { scope: "asset-presign", key: "user", limit: 120, windowMs: 3_600_000 },
];

@Controller("agent/assets")
export class AgentAssetsController {
  constructor(
    private readonly assets: AssetService,
    private readonly projects: ProjectService,
    private readonly storage: AssetStorageService,
    private readonly material: MaterialService,
  ) {}

  @Post("presign")
  @RateLimit({ buckets: ASSET_PRESIGN_BUCKETS })
  async presign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PresignAssetInput,
  ) {
    return handlePresignAsset(user.userId, body, this.storage.uploads);
  }

  @Post("uploads/presign")
  @RateLimit({ buckets: ASSET_PRESIGN_BUCKETS })
  async uploadsPresign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PresignAssetInput,
  ) {
    return handlePresignAsset(user.userId, body, this.storage.uploads);
  }

  @Post("uploads/dedup")
  @RateLimit({
    buckets: [{ scope: "asset-dedup", key: "user", limit: 30, windowMs: 60_000 }],
  })
  async uploadsDedup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DedupAssetInput,
  ) {
    return handleDedupAsset(user.userId, body, {
      projects: this.projects,
      uploads: this.assets,
      materialGate: this.material.uploadMaterialGate(),
      materialStatus: this.material.materialStatusReader(),
    });
  }

  @Post("uploads/complete")
  @RateLimit({
    buckets: [{ scope: "asset-complete", key: "user", limit: 30, windowMs: 60_000 }],
  })
  async uploadsComplete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CompleteAssetInput,
  ) {
    return handleCompleteAsset(user.userId, body, {
      projects: this.projects,
      uploads: this.assets,
      storage: this.storage.uploads,
      materialGate: this.material.uploadMaterialGate(),
      materialStatus: this.material.materialStatusReader(),
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
    if (!asset) throw new DomainError(RESOURCE_NOT_FOUND_CODE, "资源不存在");
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
