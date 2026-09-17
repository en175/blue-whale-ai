import { markerAssetIdsOf, transferReferenceMarkers } from "@lib/core";
import { buildReferenceMarkerLabels, type VideoRefItem } from "@lib/contracts";

/** 素材归属结果里本模块需要的最小投影（不反向依赖持久层类型，同 core 先例）。 */
export interface MarkerAssetResolution {
  id: string;
  material_id: string | null;
}

/**
 * IKG6EK / ADR-0088：正文引用标记转移的完整一步——提交方给的正文里素材引用写作
 * `&asset_id&`，此处按**本次请求的素材顺序**换成 `@标签`（编号现算）。
 * 后端对提示词只做这一件事：不拼装、不追加。
 *
 * 三条边界：
 * - 正文里没有标记 → 原样返回，且**不查库**（绝大多数请求走这条）。
 * - 标记的身份不在本次素材集合里 → 不转、原样保留（ADR-0088「后果」登记的已知代价）。
 * - 素材库引用（请求里以 `material_id` 表达、无本地 asset id）→ 走 IKG79Z 同款身份桥：
 *   `resolveAssets` 解出的 asset 必须 `material_id` 命中本次请求才建立映射，
 *   归属不通过的 asset 不映射（越权边界不放松）。
 */
export async function transferPromptReferenceMarkers(args: {
  prompt: string;
  /** 本端有序素材的编译投影（`id` = asset_id，material-only 项填 material_id）。 */
  items: readonly VideoRefItem[];
  /** 请求体 references 里以 material_id 表达的引用 id 集合（只可能是这些项的 id）。 */
  materialOnlyIds: readonly string[];
  resolveAssets: (ids: string[]) => Promise<readonly MarkerAssetResolution[]>;
}): Promise<string> {
  const { prompt, items, materialOnlyIds, resolveAssets } = args;
  const markerIds = markerAssetIdsOf(prompt);
  if (markerIds.length === 0) return prompt;

  const present = new Set(items.map((item) => item.id));
  const unmatched = markerIds.filter((id) => !present.has(id));
  let resolvedItems = items;
  if (unmatched.length > 0 && materialOnlyIds.length > 0) {
    const materialOnly = new Set(materialOnlyIds);
    const assets = await resolveAssets(unmatched);
    const assetIdByMaterial = new Map(
      assets
        .filter(
          (asset): asset is MarkerAssetResolution & { material_id: string } =>
            asset.material_id !== null && materialOnly.has(asset.material_id),
        )
        .map((asset) => [asset.material_id, asset.id]),
    );
    if (assetIdByMaterial.size > 0) {
      resolvedItems = items.map((item) => {
        const bridged = materialOnly.has(item.id) ? assetIdByMaterial.get(item.id) : undefined;
        return bridged === undefined ? item : { ...item, id: bridged };
      });
    }
  }
  return transferReferenceMarkers(prompt, buildReferenceMarkerLabels(resolvedItems));
}
