import type { SaveSharedAssetRequest } from "@lib/contracts";
import type { SharedAssetTextSnapshot } from "@lib/contracts";
import {
  sharedAssetSnapshotOf,
  stripHtml,
  truncate,
  type SharedAssetSaveContext,
  type SharedAssetSavePlan,
  type SharedAssetTypeStrategy,
} from "./shared-asset-type.strategy.js";

export class TextStrategy implements SharedAssetTypeStrategy {
  readonly assetType = "text" as const;
  readonly kind = null;

  async buildSavePlan(
    _ctx: SharedAssetSaveContext,
    input: SaveSharedAssetRequest,
  ): Promise<SharedAssetSavePlan> {
    const snapshot = sharedAssetSnapshotOf(input) as SharedAssetTextSnapshot;
    const plain = snapshot.text || stripHtml(snapshot.html ?? "");
    return {
      name: truncate(plain || "未命名文本", 255),
      thumbnailUrl: null,
      snapshot,
      dedupKey: null,
    };
  }
}
