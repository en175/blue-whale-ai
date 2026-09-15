import type { MaterialAssetRepo } from "@lib/shared/persistence/index.js";

// IKF YHJ：素材校验状态门（ADR-0087）。视频生成「采纳素材参考」那一刻判定素材能否使用。
// 规则（ADR-0087 决策 2）：
//   表内 Active          → 放行
//   表内 Failed 及其他   → 拒绝
//   表内 Processing / 无记录 → 实时查上游 GetAsset，用返回值判定并回写
// 「无 material_id」的引用不进入本门，由调用方过滤（从未入过素材库，不在校验范围）。
//
// 正确性锚在「拦截点自己发起的实时查询」，不依赖本地行是否新鲜——上传后关页面、之后无人
// 访问是常态，陈旧行只会让本门多查一次上游，不会误放行。

export interface UpstreamMaterialStatus {
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface MaterialComplianceDeps {
  /** 本地镜像表读写（只读判定 + 回写实时结果）。 */
  repo: Pick<MaterialAssetRepo, "findByMaterialId" | "mirrorStatus">;
  /** 实时查上游单条素材状态（需要该用户的 sk-）。上游不可达/查询失败返回 null。 */
  fetchUpstreamStatus(
    materialId: string,
  ): Promise<UpstreamMaterialStatus | null>;
}

export type MaterialGateResult =
  | { ok: true }
  | { ok: false; message: string };

/** 面向用户的统一拒绝文案：只说「未通过」，不解释原因（ADR-0087 决策 6，
 *  火山官方未公开素材库错误码枚举，本仓无从判断真实失败事由）。 */
export const MATERIAL_NOT_APPROVED_MESSAGE = "该素材未审核通过，不能用于视频生成";

/** 上游不可达时 fail-closed：放行等于赌它可用，与 ADR-0087 的取舍相反。 */
export const MATERIAL_STATUS_UNAVAILABLE_MESSAGE = "素材状态校验失败，请稍后重试";

/** 上游状态白名单收敛——认不出的值一律当未就绪（继续按不可用处理，不误判为可用）。 */
function normalizeStatus(raw: string): "Active" | "Failed" | "Processing" {
  return raw === "Active" || raw === "Failed" ? raw : "Processing";
}

/**
 * 逐个判定素材可用性。命中第一个不可用的即返回（fail-fast，错误文案统一）。
 */
export async function assertMaterialsUsable(
  deps: MaterialComplianceDeps,
  userId: string,
  materialIds: readonly string[],
): Promise<MaterialGateResult> {
  for (const materialId of materialIds) {
    const row = await deps.repo.findByMaterialId(userId, materialId);

    // 终态直接判定，不打上游——这是本表存在的意义（避免每次生成都 N 次上游往返）。
    if (row !== null && row.status !== "Processing") {
      if (row.status !== "Active") {
        return { ok: false, message: MATERIAL_NOT_APPROVED_MESSAGE };
      }
      continue;
    }

    // 非终态或无记录：实时查上游。拿到「此刻」的真实状态才是判据。
    const upstream = await deps.fetchUpstreamStatus(materialId);
    if (upstream === null) {
      return { ok: false, message: MATERIAL_STATUS_UNAVAILABLE_MESSAGE };
    }
    const status = normalizeStatus(upstream.status);
    if (row !== null) {
      // 只刷新已存在的行；无行不造行（造行需要 group id，只有 CreateAsset 拿得到）。
      // 无记录的素材因此每次都会实时查一次上游——正确性不打折，只多一次往返。
      await deps.repo.mirrorStatus({
        userId,
        materialId,
        status,
        errorCode: upstream.errorCode ?? null,
        errorMessage: upstream.errorMessage ?? null,
      });
    }
    if (status !== "Active") {
      return { ok: false, message: MATERIAL_NOT_APPROVED_MESSAGE };
    }
  }
  return { ok: true };
}

/**
 * 从生成任务输入里取出需要过门的素材库素材 id。
 * 覆盖两条来源路径（ADR-0087 背景缺口的第 3 条）：
 *   - 直接声明的素材引用（references / 旧字段的 *_material_id、reference_materials）；
 *   - 本地 Asset 已绑素材库素材时，worker 会在提交前把它转成 asset://——前端拦不住，这里补上。
 */
export function collectMaterialIds(input: {
  references?: readonly { material_id?: unknown }[] | undefined;
  firstFrameMaterialId?: unknown;
  lastFrameMaterialId?: unknown;
  referenceMaterials?: readonly { id?: unknown }[] | undefined;
  materialIdsFromLocalAssets?: readonly string[];
}): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw === "string" && raw.length > 0) out.push(raw);
  };
  for (const item of input.references ?? []) push(item?.material_id);
  push(input.firstFrameMaterialId);
  push(input.lastFrameMaterialId);
  for (const item of input.referenceMaterials ?? []) push(item?.id);
  for (const id of input.materialIdsFromLocalAssets ?? []) push(id);
  return [...new Set(out)];
}
