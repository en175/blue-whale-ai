import { Inject } from "@nestjs/common";
import { RESOURCE_NOT_FOUND_CODE } from "@lib/contracts";
import type { SaveSharedAssetRequest } from "@lib/contracts";
import { SharedAssetError } from "../shared-asset-error.js";
import type { SharedAssetSourcePort } from "../shared-asset-source.port.js";
import {
  SHARED_ASSET_SOURCE_PORT,
  sha256,
  sharedAssetSourceSceneCardIdOf,
  truncate,
  type SharedAssetSaveContext,
  type SharedAssetSavePlan,
  type SharedAssetTypeStrategy,
} from "./shared-asset-type.strategy.js";

/** 场景卡策略：从源 scene_cards + generation_presets 抓取自包含快照。
 *  - 归属校验：源场景卡须属于当前用户项目（project.owner_id）；
 *  - 去重：按内容 sha256（同内容视为已存在）；
 *  - 快照含 markdown + 生成预设，供「添加回画布」在目标项目原样重建实体。 */
export class SceneStrategy implements SharedAssetTypeStrategy {
  readonly assetType = "scene" as const;
  readonly kind = null;

  constructor(
    @Inject(SHARED_ASSET_SOURCE_PORT)
    private readonly source: SharedAssetSourcePort,
  ) {}

  async buildSavePlan(
    ctx: SharedAssetSaveContext,
    input: SaveSharedAssetRequest,
  ): Promise<SharedAssetSavePlan> {
    const sourceSceneCardId = sharedAssetSourceSceneCardIdOf(input);
    if (!sourceSceneCardId) {
      throw new SharedAssetError(RESOURCE_NOT_FOUND_CODE, "缺少源场景卡");
    }
    const result = await this.source.findOwnedSceneCard(
      sourceSceneCardId,
      ctx.userId,
    );
    if (result.kind !== "found") {
      throw new SharedAssetError(RESOURCE_NOT_FOUND_CODE, "场景卡不存在或不可用");
    }
    const scene = result.scene_card;
    return {
      name: truncate(scene.title || "未命名场景卡", 255),
      thumbnailUrl: null,
      snapshot: {
        title: scene.title,
        summary: scene.summary ?? null,
        contentMarkdown: scene.content_markdown,
        generationPreset: scene.generation_preset
          ? {
              parameters: scene.generation_preset.parameters,
              referenceMode: scene.generation_preset.reference_mode,
              referenceAssets: scene.generation_preset.reference_assets,
              capabilitySnapshotVersion:
                scene.generation_preset.capability_snapshot_version,
            }
          : null,
      },
      dedupKey: `scene:${sha256(scene.content_markdown)}`,
    };
  }
}
