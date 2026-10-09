import { Injectable } from "@nestjs/common";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { SceneCardResourceService } from "@lib/shared/scene-card/scene-card.service.js";
import type { SharedAssetSourcePort } from "./shared-asset-source.port.js";

@Injectable()
export class SharedAssetSourceAdapter implements SharedAssetSourcePort {
  constructor(
    private readonly assets: AssetService,
    private readonly sceneCard: SceneCardResourceService,
  ) {}

  findOwnedSource(sourceAssetId: string, userId: string) {
    return this.assets.findOwnedSource(sourceAssetId, userId);
  }

  findOwnedSceneCard(sceneCardId: string, userId: string) {
    return this.sceneCard.findOwnedSceneCardWithPreset(userId, sceneCardId);
  }

  copySceneCardToProject(input: Parameters<SharedAssetSourcePort["copySceneCardToProject"]>[0]) {
    return this.sceneCard.copySceneCardToProject(input);
  }
}
