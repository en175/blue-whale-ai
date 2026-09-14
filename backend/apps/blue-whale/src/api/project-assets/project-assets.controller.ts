import { Body, Controller, Get, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { fail, ok } from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import {
  handleAccessAsset,
  handleContentAsset,
  handleCopyAsset,
} from "@lib/shared/assets/project-assets.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/assets")
export class ProjectAssetsController {
  constructor(
    private readonly project: ProjectService,
    private readonly assets: AssetService,
    private readonly storage: AssetStorageService,
  ) {}

  /** IKCNLP（方案C）：素材-项目关联。画布使用素材时前端调用，幂等。 */
  @Post(":assetId/link")
  async link(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("assetId") assetId: string,
  ) {
    const project = await this.project.findOwnedById(projectId, user.userId);
    if (!project) return fail(100301, "资源不存在");
    const linked = await this.assets.linkAssetToProject({
      userId: user.userId,
      assetId,
      projectId,
    });
    return linked ? ok({ projectId, assetId }) : fail(100301, "资源不存在");
  }

  @Post()
  async copy(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: { source_asset_id?: unknown },
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return handleCopyAsset(user.userId, projectId, body, idempotencyKey, {
      project: this.project,
      assets: this.assets,
    });
  }

  @Get(":assetId")
  async access(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("assetId") assetId: string,
  ) {
    return handleAccessAsset(user.userId, projectId, assetId, {
      project: this.project,
      assets: this.assets,
      signer: this.storage.signer,
    });
  }

  @Get(":assetId/content")
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("assetId") assetId: string,
    @Res() res: Response,
  ) {
    const result = await handleContentAsset(user.userId, projectId, assetId, {
      project: this.project,
      assets: this.assets,
      reader: this.storage.reader,
    });
    if (!result.ok) {
      res.status(200).json(fail(result.code, result.msg));
      return;
    }
    res.setHeader("Content-Type", result.mime);
    res.send(Buffer.from(result.content));
  }
}
