import type { SaveSharedAssetRequest } from "@blue-whale/contracts";
import type { SharedAssetTextSnapshot } from "@blue-whale/contracts";
import {
  sharedAssetSnapshotOf,
  stripHtml,
  truncate,
  type SharedAssetSaveContext,
  type SharedAssetSavePlan,
  type SharedAssetTypeStrategy,
} from "./shared-asset-type.strategy.js";

/** 文本策略（PRD R4）：文本进「文本」tab；统一正文契约 v1 后快照权威为 Markdown 源（text），
 *  html 仅存量资产兼容（IKFM3L）。
 *  - 不做近似去重（PRD 未定义文本去重）；
 *  - 名称取纯文本截断；无缩略图。 */
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
