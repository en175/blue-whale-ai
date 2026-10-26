import type { SaveSharedAssetRequest } from "@lib/contracts";
import type { SharedAssetGoodsSnapshot } from "@lib/contracts";
import {
  sha256,
  sharedAssetSnapshotOf,
  truncate,
  truncateUrl,
  type SharedAssetSaveContext,
  type SharedAssetSavePlan,
  type SharedAssetTypeStrategy,
} from "./shared-asset-type.strategy.js";

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
