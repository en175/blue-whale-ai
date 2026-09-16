import { logger } from "@lib/infra/logging/blue-whale-logger.js";

import {
  createMaterialGate,
  isMaterialLevelRejection,
  type MaterialGate,
  type UpstreamMaterialStatus,
} from "./material-compliance-gate.js";
import type { MaterialAssetRepo } from "@lib/shared/persistence/index.js";

// IKF YHJ：把「生产实际跑的那段门」从控制器里抽出来，让它可测。
//
// 抽之前它是 GenerationJobsController 的一个私有方法：信封解析、终局 vs 可重试的分类、
// 失败处置的调用、deleteUpstream 的取舍、以及把上游异常咽成 null 的 catch——整条生产判定
// 路径都在里面，却因为挂在控制器私有位上而零测试覆盖。内核（assertMaterialsUsable）、
// 仓库层、worker 都有测试，唯独真正在线上跑的那层没有。
//
// 这里只做接线，判定逻辑仍在 material-compliance-gate.ts；本模块的价值是「可注入 + 可断言」。

export interface MaterialGateWiringDeps {
  /** 本地状态仓库面（判定用）。 */
  repo: Pick<MaterialAssetRepo, "findByMaterialId" | "mirrorStatus">;
  /** 代打网关：返回 HTTP 状态与原始体，**不抛**（抛由本模块的 catch 兜）。 */
  callAction(
    action: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
  /** 本地 Asset → 已绑素材库 id 的解析（worker 自动转 asset:// 的那条绕过路径）。 */
  resolveLocalAssetMaterialIds?(
    userId: string,
    assetIds: readonly string[],
  ): Promise<string[]>;
  /** 判定素材失败时的统一处置（ADR-0087 决策 8 的三步）。 */
  onMaterialFailure(input: {
    materialId: string;
    errorCode: string | null;
    errorMessage: string | null;
    deleteUpstream: boolean;
  }): Promise<void>;
}

/** 上游错误信封 `ResponseError` 本体（不是对象则 null）。 */
function readResponseError(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as Record<string, unknown>).ResponseError;
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : null;
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

export function createRequestMaterialGate(
  deps: MaterialGateWiringDeps,
): MaterialGate {
  return createMaterialGate({
    repo: deps.repo,
    fetchUpstreamStatus: async (materialId): Promise<UpstreamMaterialStatus | null> => {
      try {
        const upstream = await deps.callAction("GetAsset", { Id: materialId });
        const body = upstream.body;

        if (upstream.status < 200 || upstream.status >= 300) {
          const error = readResponseError(body);
          const code = readString(error, "Code");
          if (isMaterialLevelRejection(code)) {
            // 上游明确指认「这个素材用不了」（已删 / id 非法）→ 终局拒绝 + 统一处置。
            // deleteUpstream=false：上游本来就没有它，再删一次是注定 404 的往返。
            const errorMessage = readString(error, "Message");
            await deps.onMaterialFailure({
              materialId,
              errorCode: code,
              errorMessage,
              deleteUpstream: false,
            });
            return { status: "Failed", errorCode: code, errorMessage };
          }
          // 其余非 2xx（鉴权 / 限流 / 租户 / 5xx）不是素材的错 → 本轮未知，可重试。
          // 坏凭证走的还是另一套信封（{"error":{…}}，无 ResponseError），天然落不到上面。
          return null;
        }

        const result =
          typeof body === "object" && body !== null
            ? (body as Record<string, unknown>).Result
            : undefined;
        if (typeof result !== "object" || result === null) return null;
        const rec = result as Record<string, unknown>;
        if (typeof rec.Status !== "string") return null;

        const error =
          typeof rec.Error === "object" && rec.Error !== null
            ? (rec.Error as Record<string, unknown>)
            : null;
        const errorCode = readString(error, "Code");
        const errorMessage = readString(error, "Message");

        // 上游判失败 → 走与透传镜像、worker 跟进器同一个口子（ADR-0087 决策 8）。
        if (rec.Status === "Failed") {
          await deps.onMaterialFailure({
            materialId,
            errorCode,
            errorMessage,
            deleteUpstream: true,
          });
        }
        return { status: rec.Status, errorCode, errorMessage };
      } catch (error) {
        // `callAction` 在网络失败时是**抛**（不是返回错误码），缺凭证也抛 401。
        // 必须咽掉转 null：否则「上游不可达」会绕过 MATERIAL_STATUS_UNAVAILABLE_MESSAGE，
        // create 期冒成 503、retry 期直接炸掉 retryJob 的交互事务（那个事务只 catch P2002）。
        logger.warn(
          `[generation] 素材状态实时查询失败 materialId=${materialId}，按不可用处理: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
        return null;
      }
    },
    ...(deps.resolveLocalAssetMaterialIds
      ? { resolveLocalAssetMaterialIds: deps.resolveLocalAssetMaterialIds }
      : {}),
  });
}
