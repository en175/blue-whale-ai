import type { SaveSharedAssetRequest } from "@blue-whale/contracts";
import type { SharedAssetGoodsSnapshot } from "@blue-whale/contracts";
import {
  sha256,
  sharedAssetSnapshotOf,
  truncate,
  truncateUrl,
  type SharedAssetSaveContext,
  type SharedAssetSavePlan,
  type SharedAssetTypeStrategy,
} from "./shared-asset-type.strategy.js";

/** 商品策略（画布 productNode）：快照由前端直传，无第二层 kind。
 *  - 名称取快照 name；缩略图取首张商品图；
 *  - 去重：按名称 sha256（同名称近似去重，同卡片 R3）。 */
export class GoodsStrategy implements SharedAssetTypeStrategy {
  readonly assetType = "goods" as const;
  readonly kind = null;

  async buildSavePlan(
    _ctx: SharedAssetSaveContext,
    input: SaveSharedAssetRequest,
  ): Promise<SharedAssetSavePlan> {
    const snapshot = sharedAssetSnapshotOf(input) as SharedAssetGoodsSnapshot;
    return {
      name: truncate(snapshot.name.trim() || "未命名商品", 255),
      thumbnailUrl: snapshot.images?.[0]?.src
        ? truncateUrl(snapshot.images[0].src, 512)
        : null,
      snapshot,
      dedupKey: `goods:${sha256(snapshot.name.trim())}`,
    };
  }
}
