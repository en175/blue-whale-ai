import { Injectable } from "@nestjs/common";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { SceneCardResourceService } from "@lib/shared/scene-card/scene-card.service.js";
import type { SharedAssetSourcePort } from "./shared-asset-source.port.js";

/** SharedAssetSourcePort 默认适配器：转发到全局 AssetService / SceneCardResourceService。
 *  保持策略与 Service 只依赖窄接口，不直接触碰来源域仓储细节。 */
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
    // SceneCardResourceService/repo 签名为 (userId, sceneCardId)，此处透传顺序对齐。
    return this.sceneCard.findOwnedSceneCardWithPreset(userId, sceneCardId);
  }

  copySceneCardToProject(input: Parameters<SharedAssetSourcePort["copySceneCardToProject"]>[0]) {
    return this.sceneCard.copySceneCardToProject(input);
  }
}
