import { Body, Controller, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

const SOURCE_ASSET_ID_FIELD = "SourceAssetId";

const MATERIAL_ID_FIELD = "Id";

const MATERIAL_ID_PATTERN = /^asset-.{1,128}$/i;
const MATERIAL_GROUP_ID_PATTERN = /^group-.{1,128}$/i;

@Controller("material")
@BypassTransform()
export class MaterialController {
  constructor(
    private readonly material: MaterialService,
    private readonly assets: AssetService,
  ) {}

  @Post(":action")
  async callAction(
    @Param("action") action: string,
    @Body() body: unknown,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    let sourceAssetId: string | undefined;
    let payload = body;
    if (action === "CreateAsset" && isRecord(body)) {
      const raw = body[SOURCE_ASSET_ID_FIELD];
      if (typeof raw === "string" && /^\d+$/.test(raw)) {
        sourceAssetId = raw;
      } else if (SOURCE_ASSET_ID_FIELD in body) {
        logger.warn(
          `material CreateAsset: 非法 ${SOURCE_ASSET_ID_FIELD} 已丢弃（${JSON.stringify(raw)}）`,
        );
      }
      if (SOURCE_ASSET_ID_FIELD in body) {
        const { [SOURCE_ASSET_ID_FIELD]: _stripped, ...rest } = body;
        payload = rest;
      }
      if (user && sourceAssetId) {
        const alreadyLinked = await this.material.preflightCreateAsset({
          userId: user.userId,
          sourceAssetId,
        });
        if (alreadyLinked) {
          res.status(alreadyLinked.status).json(alreadyLinked.body);
          return;
        }
      }
      if (user && !(payload as Record<string, unknown>).GroupId) {
        const groupId = await this.material.ensureVirtualDefaultGroup(
          user.userId,
        );
        payload = { ...(payload as Record<string, unknown>), GroupId: groupId };
      }
    }

    if (user) {
      const local = await this.material.tryServeLocalGroupAction(
        user.userId,
        action,
        payload,
      );
      if (local) {
        res.status(local.status).json(local.body);
        return;
      }
      const failed = await this.material.tryServeLocalFailedAsset(
        user.userId,
        action,
        payload,
      );
      if (failed) {
        res.status(failed.status).json(failed.body);
        return;
      }
    }

    const upstream = await this.material.callAction(action, payload);
    res.status(upstream.status).json(upstream.body);

    if (upstream.status >= 200 && upstream.status < 300 && user) {
      try {
        await this.applyLinkSideEffects(
          action,
          isRecord(body) && isRecord(payload) ? { ...body, ...payload } : payload,
          upstream.body,
          user.userId,
        );
      } catch (error) {
        logger.error(
          `material ${action} link side-effect failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async applyLinkSideEffects(
    action: string,
    body: unknown,
    upstreamBody: unknown,
    userId: string,
  ): Promise<void> {
    if (action === "CreateAsset") {
      const sourceAssetId = isRecord(body)
        ? body[SOURCE_ASSET_ID_FIELD]
        : undefined;
      const groupId = isRecord(body) ? body.GroupId : undefined;
      const materialId = readResultId(upstreamBody);
      if (typeof materialId === "string" && typeof groupId === "string") {
        if (
          MATERIAL_ID_PATTERN.test(materialId) &&
          MATERIAL_GROUP_ID_PATTERN.test(groupId)
        ) {
          await this.material.trackMaterialProcessing(
            userId,
            materialId,
            groupId,
          );
          if (typeof sourceAssetId === "string") {
            await this.assets.linkAssetToMaterial({
              userId,
              assetId: sourceAssetId,
              materialId,
            });
          }
        } else {
          logger.warn(
            `material CreateAsset: 上游 id 格式异常已跳过绑定与状态落行（material=${materialId} group=${groupId}）`,
          );
        }
      }
      return;
    }
    if (action === "DeleteAsset") {
      const id = isRecord(body) ? body.Id : undefined;
      if (typeof id === "string" && MATERIAL_ID_PATTERN.test(id)) {
        await this.assets.clearMaterialLink(userId, id);
        await this.material.clearMaterialStatus(userId, id);
      }
      return;
    }
    if (action === "DeleteAssetGroup") {
      const id = isRecord(body) ? body.Id : undefined;
      if (typeof id === "string" && MATERIAL_GROUP_ID_PATTERN.test(id)) {
        await this.assets.clearMaterialGroupLink(userId, id);
        await this.material.softDeleteLocalGroup(userId, id);
        await this.material.clearMaterialStatusByGroup(userId, id);
      }
      return;
    }
    if (action === "GetVisualValidateResult") {
      const groupId = isRecord(upstreamBody) ? upstreamBody.GroupId : undefined;
      if (typeof groupId === "string" && MATERIAL_GROUP_ID_PATTERN.test(groupId)) {
        await this.material.recordClaimedRealGroup(userId, groupId);
      }
      return;
    }
    if (action === "ListAssets" || action === "GetAsset") {
      await this.material.ingestUpstreamMaterialStatuses(userId, upstreamBody);
      return;
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readResultId(upstreamBody: unknown): string | undefined {
  if (!isRecord(upstreamBody)) return undefined;
  const result = upstreamBody.Result;
  if (!isRecord(result)) return undefined;
  const id = result[MATERIAL_ID_FIELD];
  return typeof id === "string" ? id : undefined;
}
