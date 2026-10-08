import { ASSET_UNAVAILABLE_CODE } from "@lib/contracts";
import type {
  SaveSharedAssetRequest,
  SharedAssetKind,
} from "@lib/contracts";
import { SharedAssetError } from "../shared-asset-error.js";
import type { SharedAssetSourcePort } from "../shared-asset-source.port.js";
import {
  sha256,
  sharedAssetRequestNameOf,
  sharedAssetSourceAssetIdOf,
  truncate,
  truncateUrl,
  type SharedAssetSaveContext,
  type SharedAssetSavePlan,
  type SharedAssetTypeStrategy,
} from "./shared-asset-type.strategy.js";

export class MediaStrategy implements SharedAssetTypeStrategy {
  readonly assetType = "media" as const;
  readonly kind: SharedAssetKind;

  constructor(
    private readonly source: SharedAssetSourcePort,
    kind: "image" | "video" | "audio",
  ) {
    this.kind = kind;
  }

  async buildSavePlan(
    ctx: SharedAssetSaveContext,
    input: SaveSharedAssetRequest,
  ): Promise<SharedAssetSavePlan> {
    const sourceAssetId = sharedAssetSourceAssetIdOf(input);
    if (!sourceAssetId) {
      throw new SharedAssetError(ASSET_UNAVAILABLE_CODE, "缺少源素材");
    }
    const asset = await this.source.findOwnedSource(sourceAssetId, ctx.userId);
    if (!asset) {
      throw new SharedAssetError(ASSET_UNAVAILABLE_CODE, "源素材不可用或不存在");
    }
    if (asset.type !== this.kind) {
      throw new SharedAssetError(
        ASSET_UNAVAILABLE_CODE,
        "素材类型与保存类型不一致",
      );
    }
    const duration =
      asset.duration_ms == null ? 0 : asset.duration_ms / 1000;
    return {
      name: truncate(
        sharedAssetRequestNameOf(input)?.trim() || basename(asset.url) || "未命名素材",
        255,
      ),
      thumbnailUrl: truncateUrl(asset.url, 512),
      snapshot: {
        url: asset.url,
        mime: asset.mime ?? null,
        size: asset.size != null ? Number(asset.size) : null,
        width: asset.width ?? null,
        height: asset.height ?? null,
        duration,
      },
      dedupKey: `media:${sha256(asset.url)}`,
    };
  }
}

function basename(url: string): string {
  const last = url.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
