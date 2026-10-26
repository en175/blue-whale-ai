import type {
  AssetSourceFields,
  CopySceneCardToProjectInput,
  CopySceneCardToProjectResult,
  FindOwnedSceneCardWithPresetResult,
} from "@lib/shared/persistence/index.js";

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
