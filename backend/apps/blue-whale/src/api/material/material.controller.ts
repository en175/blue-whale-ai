// 素材库透传镜像：POST /api/material/{Action}（对齐上游网关对外入口形状）。
// - Action 白名单在 MaterialService；请求体（含真人会话 CallbackURL，由前端传入）原样透传。
// - 上游状态码与信封（ResponseMetadata/Result、ResponseError、真人会话直接格式）
//   经 @Res 原样回传；因此类级 @BypassTransform，避免被统一信封二次包裹。
// - 产品侧错误（非法 Action/缺凭证/未配置/网关不可达）抛 NewApiError，
//   由 AllExceptionsFilter 统一成产品 {code, msg, data} 信封。
// - IKDJNZ 关联旁路：CreateAsset / DeleteAsset / DeleteAssetGroup 上游成功后同步维护
//   本地 assets 的素材库关联字段（上游为权威，本地只做关联镜像；失败仅告警不阻断透传）。
// - IKEXX8 组查询分流（契约 v2 §5）：ListAssetGroups(AIGC) / GetAssetGroup（本地命中）
//   读 material_groups 返回上游同款信封、不打远程；其余（含真人组）透传不变，前端无感。
import { Body, Controller, Param, Post, Res } from "@nestjs/common";
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

/** 素材库素材 id / 组 id 格式（对齐上游：素材 asset-...，组 group-...；与生成侧 MATERIAL_ID_PATTERN 同源）。 */
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
    // IKDJNZ：CreateAsset 的原始素材 id 是产品侧字段，透传前剥离，上游请求体保持原样。
    let sourceAssetId: string | undefined;
    let payload = body;
    if (action === "CreateAsset" && isRecord(body)) {
      const raw = body[SOURCE_ASSET_ID_FIELD];
      if (typeof raw === "string" && /^\d+$/.test(raw)) {
        sourceAssetId = raw;
      } else if (SOURCE_ASSET_ID_FIELD in body) {
        // 非法原始素材 id：静默丢弃前留痕，便于发现前端未接/接错的死绑定。
        logger.warn(
          `material CreateAsset: 非法 ${SOURCE_ASSET_ID_FIELD} 已丢弃（${JSON.stringify(raw)}）`,
        );
      }
      if (SOURCE_ASSET_ID_FIELD in body) {
        const { [SOURCE_ASSET_ID_FIELD]: _stripped, ...rest } = body;
        payload = rest;
      }
      // IKDE6X：虚拟人像上传到「虚拟默认组」——前端不感知组、不传 GroupId。
      // 兜底仅当前端未传 GroupId 时生效（传了组 = 真人组/显式指定，不覆盖）；未传则
      // ensureVirtualDefaultGroup 建组（无则上游建 + 本地落表）+ 强制替换 GroupId。
      // 建组失败（拿不到虚拟组）抛错阻断，不静默拖到上游 400。
      if (user && !(payload as Record<string, unknown>).GroupId) {
        const groupId = await this.material.ensureVirtualDefaultGroup(
          user.userId,
        );
        payload = { ...(payload as Record<string, unknown>), GroupId: groupId };
      }
    }

    // IKEXX8：组查询分流——命中本地读规则（虚拟组列表/详情命中）直接回上游同款信封，不打远程；
    // 未登录（无 user，理论不达）或未命中 → 走透传，行为与改造前一致。
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
      // IKF YHJ：GetAsset 的本地优先——已判 Failed 的素材直接回本地结论。
      // 那张素材已被删除上游，再透传只会拿到 NotFound，前端会看到「不存在」而非「未通过」。
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

    // IKDJNZ：关联旁路——仅上游 2xx 成功且当前用户可解析时执行；失败只告警，不阻断透传响应。
    if (upstream.status >= 200 && upstream.status < 300 && user) {
      try {
        // IKDE6X：关联旁路合并两来源——SourceAssetId 在剥离前的原 body，GroupId 在强制替换后的
        // payload（虚拟组场景前端不传 GroupId，必须取替换后的才能落 assets.material_group_id）。
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
      // IKF YHJ：id/组 id 格式兜底（asset-.../group-...）；脏数据不落库，避免污染生成链路。
      if (typeof materialId === "string" && typeof groupId === "string") {
        if (
          MATERIAL_ID_PATTERN.test(materialId) &&
          MATERIAL_GROUP_ID_PATTERN.test(groupId)
        ) {
          // IKF YHJ：状态行只依赖 materialId + groupId，与是否携带 SourceAssetId 无关——
          // 漏传 SourceAssetId 时素材仍存在（只是没绑本地 Asset），状态仍需跟踪。
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
              materialGroupId: groupId,
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
        // IKF YHJ：素材已删，状态行随之硬删（ADR-0087 决策 5），否则残留 Active 会让拦截点误放行。
        await this.material.clearMaterialStatus(userId, id);
      }
      return;
    }
    if (action === "DeleteAssetGroup") {
      const id = isRecord(body) ? body.Id : undefined;
      if (typeof id === "string" && MATERIAL_GROUP_ID_PATTERN.test(id)) {
        await this.assets.clearMaterialGroupLink(userId, id);
        // IKEXX8：上游删成功后软删本地虚拟组行（真人组无本地行=空操作；失败仅告警不阻断）。
        await this.material.softDeleteLocalGroup(userId, id);
        await this.material.clearMaterialStatusByGroup(userId, id);
      }
      return;
    }
    // IKF YHJ：素材状态镜像——前端列表/详情轮询经过本控制器时顺带回写本地行。
    // 纯收益，不承担正确性（正确性锚在生成拦截点的实时查询，见 ADR-0087 被否方案末条）。
    if (action === "ListAssets" || action === "GetAsset") {
      const entries = readAssetStatusEntries(upstreamBody);
      if (entries.length > 0) {
        await this.material.mirrorMaterialStatuses(userId, entries);
        // IKF YHJ：任何一个条目被判 Failed 都触发统一处置（删上游 + 留 Failed + 清关联）。
        // 放在这里而不是 mirrorMaterialStatuses 里：镜像是纯回写，处置带副作用，分开好读也好测。
        for (const entry of entries) {
          if (entry.status !== "Failed") continue;
          await this.material.handleUpstreamMaterialFailure({
            userId,
            materialId: entry.materialId,
            errorCode: entry.errorCode ?? null,
            errorMessage: entry.errorMessage ?? null,
          });
        }
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

/** IKF YHJ：从 GetAsset（Result 本体）/ ListAssets（Result.Items）信封取出可镜像的状态项。
 *  认不出形状或 id 格式不对的一律丢弃——镜像宁缺勿错，错误项由生成拦截点的实时查询兜底。 */
function readAssetStatusEntries(upstreamBody: unknown): Array<{
  materialId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
}> {
  if (!isRecord(upstreamBody)) return [];
  const result = upstreamBody.Result;
  if (!isRecord(result)) return [];
  const rawItems = Array.isArray(result.Items) ? result.Items : [result];
  const entries: Array<{
    materialId: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
  }> = [];
  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const id = raw[MATERIAL_ID_FIELD];
    const status = raw.Status;
    if (
      typeof id !== "string" ||
      !MATERIAL_ID_PATTERN.test(id) ||
      typeof status !== "string"
    ) {
      continue;
    }
    const error = isRecord(raw.Error) ? raw.Error : undefined;
    const code = error?.Code;
    const message = error?.Message;
    entries.push({
      materialId: id,
      status,
      errorCode: typeof code === "string" ? code : null,
      errorMessage: typeof message === "string" ? message : null,
    });
  }
  return entries;
}
