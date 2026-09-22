import {
  MATERIAL_NOT_APPROVED_MESSAGE,
  MATERIAL_STATUS_UNAVAILABLE_MESSAGE,
  isMaterialLevelRejection,
} from "@lib/shared/generation/material-compliance-gate.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import type { MaterialAssetRepo } from "@lib/shared/persistence/index.js";

// IKGQWR：**上传口**的素材闸（ADR-0093 决策 3）。与生成门（material-compliance-gate.ts）
// 同规则、同文案、同错误码分类，差别只有两处，且都是有意的：
//
//   1. 上游 `GetAsset` 的 `Result.GroupId` 在这里被用起来。上传口要往 `assets.material_group_id`
//      落列，组 id 只能从本地行或上游拿。
//   2. **无记录时补建行**。生成门做不到这件事——它的注释写着「无行不造行（造行需要 group id，
//      只有 CreateAsset 拿得到）」，于是无记录的素材每次生成都要实时查一次上游。上传口是第二个
//      拿得到 group id 的位置（上游 GetAsset 会给），补一次行之后存量素材不必每次回查。
//
// 规则本身（ADR-0087 决策 2）与生成门逐字一致，不重新发明：
//   Active → 放行 / Failed 及其他 → 拒绝 / Processing 或无记录 → 实时查上游并回写 / 上游不可达 → 拒绝

/** 上游单条素材里上传口需要的字段（比生成门多一个 `groupId`）。 */
export interface UpstreamMaterialAsset {
  status: string;
  /** `Result.GroupId`。拿不到时 null——此时仍放行，只是 `assets.material_group_id` 留空。 */
  groupId: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface UploadMaterialGateResult {
  /** 放行时**必须**给出素材组 id（允许 null，见 {@link UpstreamMaterialAsset.groupId}）。 */
  ok: true;
  materialGroupId: string | null;
}
export type UploadMaterialGateOutcome =
  | UploadMaterialGateResult
  | { ok: false; message: string };

export interface UploadMaterialGateDeps {
  repo: Pick<
    MaterialAssetRepo,
    "findByMaterialId" | "mirrorStatus" | "upsertProcessing"
  >;
  /** 实时查上游单条素材。上游不可达 / 信封异常 → null（「本轮未知」）。 */
  fetchUpstream(materialId: string): Promise<UpstreamMaterialAsset | null>;
}

/** 上游状态白名单收敛——认不出的值一律当未就绪（与生成门同一口径）。 */
function normalizeStatus(raw: string): "Active" | "Failed" | "Processing" {
  return raw === "Active" || raw === "Failed" ? raw : "Processing";
}

/**
 * 判定一个素材库素材此刻能否被关联到本地资产，并给出它的素材组 id。
 *
 * 与生成门的 `assertMaterialsUsable` 是**同一个规则的两个调用点**，不是两份实现：
 * 那边走的是 job 输入里的 id 列表，这边走的是用户在上传时指名的那一个。
 */
export async function assertMaterialLinkable(
  deps: UploadMaterialGateDeps,
  userId: string,
  materialId: string,
): Promise<UploadMaterialGateOutcome> {
  const row = await deps.repo.findByMaterialId(userId, materialId);

  // 终态直接判，不打上游——这是本表存在的意义。
  if (row !== null && row.status !== "Processing") {
    return row.status === "Active"
      ? { ok: true, materialGroupId: row.materialGroupId }
      : { ok: false, message: MATERIAL_NOT_APPROVED_MESSAGE };
  }

  // 非终态或无记录：实时查上游，拿到「此刻」的真实状态才是判据。
  const upstream = await deps.fetchUpstream(materialId);
  if (upstream === null) {
    return { ok: false, message: MATERIAL_STATUS_UNAVAILABLE_MESSAGE };
  }
  const status = normalizeStatus(upstream.status);

  if (row !== null) {
    await deps.repo.mirrorStatus({
      userId,
      materialId,
      status,
      errorCode: upstream.errorCode ?? null,
      errorMessage: upstream.errorMessage ?? null,
    });
  } else if (upstream.groupId) {
    // IKGQWR：上传口独有的补行机会（ADR-0093 决策 3）。先落 Processing 再镜像终态——
    // `upsertProcessing` 的契约就是「CreateAsset 那一刻上游必然尚未 Active」，而这里可能
    // 已经查到终态，所以要跟一次 mirrorStatus 把它覆盖成真实值。
    await deps.repo.upsertProcessing({
      userId,
      materialId,
      materialGroupId: upstream.groupId,
    });
    if (status !== "Processing") {
      await deps.repo.mirrorStatus({
        userId,
        materialId,
        status,
        errorCode: upstream.errorCode ?? null,
        errorMessage: upstream.errorMessage ?? null,
      });
    }
  } else {
    // 无行且上游没给组 id → 不造行（与生成门同口径：不拿脏数据换一次写）。
    // 判定照常进行，只是这一次不会留下本地行。
    logger.warn(
      `[upload] 素材无本地状态行且上游未返回 GroupId，跳过补行 materialId=${materialId}`,
    );
  }

  if (status !== "Active") {
    return { ok: false, message: MATERIAL_NOT_APPROVED_MESSAGE };
  }
  // 组 id 优先取此刻上游给的（它比本地行新鲜），退回本地行；两者都没有就留 null。
  return { ok: true, materialGroupId: upstream.groupId ?? row?.materialGroupId ?? null };
}

export interface UploadMaterialGateWiringDeps {
  repo: UploadMaterialGateDeps["repo"];
  /** 代打网关：返回 HTTP 状态与原始体，**不抛**（抛由本模块的 catch 兜）。 */
  callAction(
    action: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
  /** 上游判失败时的统一处置（ADR-0087 决策 8 的三步），与生成门同一个口子。 */
  onMaterialFailure(input: {
    userId: string;
    materialId: string;
    errorCode: string | null;
    errorMessage: string | null;
    deleteUpstream: boolean;
  }): Promise<void>;
}

function readResponseError(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as Record<string, unknown>).ResponseError;
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : null;
}

function readString(
  source: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * 接线：把上游信封解析成上传口要的形状。解析规则与 `material-gate-wiring.ts`
 * （生成门那侧）逐条对齐——终局 vs 本轮未知的分野必须两边一致，否则同一个素材在
 * 上传口和生成口会得到相反的结论。
 */
export function createUploadMaterialGate(
  deps: UploadMaterialGateWiringDeps,
): {
  check(userId: string, materialId: string): Promise<UploadMaterialGateOutcome>;
} {
  return {
    check: async (userId, materialId) => {
      const gateDeps: UploadMaterialGateDeps = {
        repo: deps.repo,
        fetchUpstream: async (id) => {
          try {
            const upstream = await deps.callAction("GetAsset", { Id: id });
            const body = upstream.body;

            if (upstream.status < 200 || upstream.status >= 300) {
              const error = readResponseError(body);
              const code = readString(error, "Code");
              if (isMaterialLevelRejection(code)) {
                // 上游明确指认「这个素材用不了」（已删 / id 非法）→ 终局 + 统一处置。
                // deleteUpstream=false：上游本来就没有它，再删一次是注定 404 的往返。
                const errorMessage = readString(error, "Message");
                await deps.onMaterialFailure({
                  userId,
                  materialId: id,
                  errorCode: code,
                  errorMessage,
                  deleteUpstream: false,
                });
                return { status: "Failed", groupId: null, errorCode: code, errorMessage };
              }
              // 其余非 2xx（鉴权 / 限流 / 租户 / 5xx）不是素材的错 → 本轮未知，可重试。
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

            if (rec.Status === "Failed") {
              await deps.onMaterialFailure({
                userId,
                materialId: id,
                errorCode,
                errorMessage,
                deleteUpstream: true,
              });
            }
            return {
              status: rec.Status,
              groupId: readString(rec, "GroupId"),
              errorCode,
              errorMessage,
            };
          } catch (error) {
            // `callAction` 在网络失败时是**抛**（不是返回错误码），缺凭证也抛 401。
            // 必须咽掉转 null：否则「上游不可达」会绕过 MATERIAL_STATUS_UNAVAILABLE_MESSAGE，
            // 冒成 500 而不是设计好的 400。
            logger.warn(
              `[upload] 素材状态实时查询失败 materialId=${id}，按不可用处理: ${
                error instanceof Error ? error.message : "unknown"
              }`,
            );
            return null;
          }
        },
      };
      return assertMaterialLinkable(gateDeps, userId, materialId);
    },
  };
}
