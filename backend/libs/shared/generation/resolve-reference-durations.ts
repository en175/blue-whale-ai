/* ============================================
 * IKJIVA：报价端点与建任务端点共享的「合并后 references 服务端复核 + 时长回填」管线。
 *
 * 此前两侧各自手工维护同一序列（筛缺时长视频引用 → resolveInputAssets → 数量比对 →
 * 构造 secondsByAssetId → 调 withVideoReferenceDurations），审查 Important 1（PR !968）
 * 指出任何一侧调整另一侧不会自动跟随——本模块把序列收成单份，两侧只保留各自有意的差异：
 *
 *   - 筛选面（assetIdsOf 谓词，两个具名导出）：建任务取全量本地引用（存在性/类型复核面，
 *     fail closed）；报价只取缺时长视频（回填面，最小查询）。统一任一方都会改变现状行为。
 *   - 失败语义：shortfall 由调用方处置——建任务 400（invalid_reference）、报价不回填
 *     按用户所选时长出价（只读保守回落，合并不丢）。
 * ============================================ */
import type { AssetOwnershipOps, WorkerInputAsset } from "@lib/shared/persistence/index.js";

import type { ReferenceItemInput } from "./reference-item-input.js";

/** IKJGE6：视频参考时长的权威补齐（建任务与报价共用）。缺 `duration` 的本地视频引用按
 *  查得的素材时长（assets.duration，`resolveInputAssets` 顺带查出）回填；查不到或非正数
 *  保持原样——计价侧按「量不到源时长」回落（applyEditSourceDurationBasis 的既有立场）。
 *  素材库引用（material_id，本地零表）只能靠调用方带，不在本函数职责内。 */
function withVideoReferenceDurations(
  references: ReadonlyArray<ReferenceItemInput>,
  secondsByAssetId: ReadonlyMap<string, number | null>,
): ReferenceItemInput[] {
  return references.map((item) => {
    if (item.type !== "video" || item.duration !== undefined || item.asset_id === undefined) {
      return item;
    }
    const seconds = secondsByAssetId.get(String(item.asset_id));
    return typeof seconds === "number" && seconds > 0 ? { ...item, duration: seconds } : item;
  });
}

/** 报价面筛选（只读路径最小查询）：仅「type=video ∧ 本地 asset ∧ 未带 duration」的引用
 *  需要服务端查时长；去重后交给 {@link resolveReferenceDurations}。 */
export function videoAssetIdsNeedingDuration(
  references: ReadonlyArray<ReferenceItemInput>,
): string[] {
  return [
    ...new Set(
      references
        .filter(
          (item) =>
            item.type === "video" && item.asset_id !== undefined && item.duration === undefined,
        )
        .map((item) => String(item.asset_id)),
    ),
  ];
}

/** 建任务面筛选（写路径全量复核面）：全部本地 asset 引用（不限媒体类型——存在性/类型
 *  复核覆盖图片；时长回填由 withVideoReferenceDurations 只动视频条目）；去重后交给
 *  {@link resolveReferenceDurations}。 */
export function localAssetReferenceIds(
  references: ReadonlyArray<ReferenceItemInput>,
): string[] {
  return [
    ...new Set(
      references
        .filter((item) => item.asset_id !== undefined)
        .map((item) => String(item.asset_id)),
    ),
  ];
}

/** 共享管线的产出判别：shortfall 交调用方各自处置（见模块头），resolved 携带回填后的
 *  references 与「asset_id → 素材行」映射（建任务侧的类型复核读它，免一次查询）。 */
export type ReferenceDurationResolution =
  | { kind: "shortfall" }
  | {
      kind: "resolved";
      references: ReferenceItemInput[];
      assetsById: ReadonlyMap<string, WorkerInputAsset>;
    };

/** IKJIVA：单份「筛选 + resolveInputAssets + 数量比对 + 构造 secondsByAssetId + 回填」。
 *
 *  ⚠️ resolveInputAssets 输出与输入**等长对位**、缺失 id 丢行（asset-ownership-repo.ts），
 *     所以数量比对 `resolved.length === ids.length` 即「全部存在/有权」，去重前后语义等价。
 *  ⚠️ 回填是纯内存变换：建任务侧的类型复核放在本函数返回**之后**执行，与夹在比对和回填
 *     之间行为等价（400 路径整体丢弃，无副作用）。 */
export async function resolveReferenceDurations(args: {
  references: ReadonlyArray<ReferenceItemInput>;
  /** 筛选面（两侧唯一有意差异）：建任务传 {@link localAssetReferenceIds}，报价传
   *  {@link videoAssetIdsNeedingDuration}。 */
  assetIdsOf: (references: ReadonlyArray<ReferenceItemInput>) => string[];
  userId: string;
  projectId: string;
  assets: Pick<AssetOwnershipOps, "resolveInputAssets">;
}): Promise<ReferenceDurationResolution> {
  const assetIds = args.assetIdsOf(args.references);
  if (assetIds.length === 0) {
    // 无本地引用：不查库，references 原样（新数组保持「resolved 引用可安全组装」的统一形态）。
    return { kind: "resolved", references: [...args.references], assetsById: new Map() };
  }
  const resolved = await args.assets.resolveInputAssets(assetIds, args.userId, args.projectId);
  if (resolved.length !== assetIds.length) return { kind: "shortfall" };
  const assetsById = new Map(assetIds.map((id, i) => [id, resolved[i]!]));
  // secondsByAssetId 内部化：除回填外无其他消费者，不外泄（复核读 assetsById）。
  const secondsByAssetId = new Map(assetIds.map((id, i) => [id, resolved[i]!.duration]));
  return {
    kind: "resolved",
    references: withVideoReferenceDurations(args.references, secondsByAssetId),
    assetsById,
  };
}
