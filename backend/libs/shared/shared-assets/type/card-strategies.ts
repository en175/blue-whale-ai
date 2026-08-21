import { SHARED_ASSET_EMPTY_CARD_CODE } from "@blue-whale/contracts";
import type {
  SaveSharedAssetRequest,
  SharedAssetCardSnapshot,
  SharedAssetKind,
} from "@blue-whale/contracts";
import { SharedAssetError } from "../shared-asset-error.js";
import {
  sha256,
  sharedAssetSnapshotOf,
  truncate,
  truncateUrl,
  type SharedAssetSaveContext,
  type SharedAssetSavePlan,
  type SharedAssetTypeStrategy,
} from "./shared-asset-type.strategy.js";

/** 卡片类策略公共逻辑（画布 assetNode，data.kind ∈ style/character/object/environment/custom）：
 *  - 校验 E6：无参考图且无描述 → 拒绝保存；
 *  - 近似去重 R3：同 kind + 同描述视为已存在（参考图集合不参与判定）；空描述跳过去重；
 *  - 名称取描述截断；缩略图取首张参考图。
 *  当前五型共享本实现；未来 per-kind 差异（如角色卡音色必填）在子类覆写 buildSavePlan。 */
export abstract class CardStrategy implements SharedAssetTypeStrategy {
  abstract readonly kind: SharedAssetKind;
  readonly assetType = "card" as const;

  async buildSavePlan(
    _ctx: SharedAssetSaveContext,
    input: SaveSharedAssetRequest,
  ): Promise<SharedAssetSavePlan> {
    const snapshot = sharedAssetSnapshotOf(input) as SharedAssetCardSnapshot | null;
    const hasReference = (snapshot?.referenceImages?.length ?? 0) > 0;
    const description = snapshot?.description?.trim() ?? "";
    if (!hasReference && !description) {
      throw new SharedAssetError(
        SHARED_ASSET_EMPTY_CARD_CODE,
        "请先为卡片补充参考图或描述",
      );
    }
    return {
      name: truncate(description || "未命名卡片", 255),
      thumbnailUrl: snapshot?.referenceImages?.[0]?.src
        ? truncateUrl(snapshot.referenceImages[0].src, 512)
        : null,
      snapshot: snapshot ?? { referenceImages: [] },
      dedupKey: description
        ? `card:${this.kind}:${sha256(description)}`
        : null,
    };
  }
}

export class StyleCardStrategy extends CardStrategy {
  readonly kind = "style";
}

export class CharacterCardStrategy extends CardStrategy {
  readonly kind = "character";
}

export class ObjectCardStrategy extends CardStrategy {
  readonly kind = "object";
}

export class EnvironmentCardStrategy extends CardStrategy {
  readonly kind = "environment";
}

export class CustomCardStrategy extends CardStrategy {
  readonly kind = "custom";
}
