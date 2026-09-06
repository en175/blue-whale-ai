// 素材库透传镜像：POST /api/material/{Action}（对齐上游网关对外入口形状）。
// - 鉴权：全局 AuthGuard 按登录会话校验并回注 Bearer sk-，本控制器不自建鉴权。
// - Action 白名单在 MaterialService；请求体（含真人会话 CallbackURL，由前端传入）原样透传。
// - 上游状态码与信封（ResponseMetadata/Result、ResponseError、真人会话直接格式）
//   经 @Res 原样回传；因此类级 @BypassTransform，避免被统一信封二次包裹。
// - 产品侧错误（非法 Action/缺凭证/未配置/网关不可达）抛 NewApiError，
//   由 AllExceptionsFilter 统一成产品 {code, msg, data} 信封。
// - IKDJNZ 关联旁路：CreateAsset / DeleteAsset / DeleteAssetGroup 上游成功后同步维护
//   本地 assets 的素材库关联字段（上游为权威，本地只做关联镜像；失败仅告警不阻断透传）。
import { Body, Controller, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

/** CreateAsset 请求体里携带的原始素材 id（需求 #1：上传素材库素材时带上原始素材 id）。 */
const SOURCE_ASSET_ID_FIELD = "SourceAssetId";

/** 上游 CreateAsset 成功信封 Result 里的素材 id 字段。 */
const MATERIAL_ID_FIELD = "Id";

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
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    // IKDJNZ：CreateAsset 的原始素材 id 是产品侧字段，透传前剥离，上游请求体保持原样。
    let sourceAssetId: string | undefined;
    let payload = body;
    if (action === "CreateAsset" && isRecord(body)) {
      const raw = body[SOURCE_ASSET_ID_FIELD];
      if (typeof raw === "string" && /^\d+$/.test(raw)) {
        sourceAssetId = raw;
      }
      if (SOURCE_ASSET_ID_FIELD in body) {
        const { [SOURCE_ASSET_ID_FIELD]: _stripped, ...rest } = body;
        payload = rest;
      }
    }

    const upstream = await this.material.callAction(authorization, action, payload);
    res.status(upstream.status).json(upstream.body);

    // IKDJNZ：关联旁路——仅上游 2xx 成功且当前用户可解析时执行；失败只告警，不阻断透传响应。
    if (upstream.status >= 200 && upstream.status < 300 && user) {
      try {
        await this.applyLinkSideEffects(action, body, upstream.body, user.userId);
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
      if (
        typeof sourceAssetId === "string" &&
        typeof groupId === "string" &&
        typeof materialId === "string"
      ) {
        await this.assets.linkAssetToMaterial({
          userId,
          assetId: sourceAssetId,
          materialId,
          materialGroupId: groupId,
        });
      }
      return;
    }
    if (action === "DeleteAsset") {
      const id = isRecord(body) ? body.Id : undefined;
      if (typeof id === "string") {
        await this.assets.clearMaterialLink(userId, id);
      }
      return;
    }
    if (action === "DeleteAssetGroup") {
      const id = isRecord(body) ? body.Id : undefined;
      if (typeof id === "string") {
        await this.assets.clearMaterialGroupLink(userId, id);
      }
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
