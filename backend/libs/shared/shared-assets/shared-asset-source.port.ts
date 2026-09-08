import type {
  AssetSourceFields,
  CopySceneCardToProjectInput,
  CopySceneCardToProjectResult,
  FindOwnedSceneCardWithPresetResult,
} from "@lib/shared/persistence/index.js";

/** 共享资产生成对来源（assets / scene_cards）的窄只读接口：
 *  媒体保存校验（归属/正常）+ 缩略图/元数据快照；场景卡保存取内容快照、添加回画布复制实体。
 *  由 SharedAssetsModule 内的适配器实现，隔离对资产/场景卡域的具体依赖，便于替换与测试。 */
export interface SharedAssetSourcePort {
  findOwnedSource(
    sourceAssetId: string,
    userId: string,
  ): Promise<AssetSourceFields | null>;

  findOwnedSceneCard(
    sceneCardId: string,
    userId: string,
  ): Promise<FindOwnedSceneCardWithPresetResult>;

  copySceneCardToProject(
    input: CopySceneCardToProjectInput,
  ): Promise<CopySceneCardToProjectResult>;
}
