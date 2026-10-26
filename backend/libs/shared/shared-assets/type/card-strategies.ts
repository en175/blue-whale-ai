import { SHARED_ASSET_EMPTY_CARD_CODE } from "@lib/contracts";
import type {
  SaveSharedAssetRequest,
  SharedAssetCardSnapshot,
  SharedAssetKind,
} from "@lib/contracts";
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
